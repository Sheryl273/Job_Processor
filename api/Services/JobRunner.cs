using Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Api.Services;

/// <summary>
/// Executes a claimed job: runs the handler, handles success/failure/dead-letter,
/// integrates with CircuitBreakerManager for canary and in-flight failure handling,
/// writes all audit rows in one SaveChanges call.
/// </summary>
public sealed class JobRunner(
    IDbContextFactory<AppDbContext> factory,
    HandlerRegistry handlers,
    CircuitBreakerManager circuitBreaker,
    IOptions<ProcessingOptions> opts,
    ILogger<JobRunner> log)
{
    private readonly ProcessingOptions _opts = opts.Value;

    public async Task ExecuteAsync(Job job, string workerId, CancellationToken ct)
    {
        var handler = handlers.Get(job.Type);
        Exception? handlerEx = null;

        try
        {
            await handler.HandleAsync(job.Id, ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Shutdown – do not write failure; lease reaper will reclaim
            log.LogInformation("Job {JobId} cancelled during shutdown", job.Id);
            return;
        }
        catch (Exception ex)
        {
            handlerEx = ex;
        }

        await using var db = await factory.CreateDbContextAsync(ct);

        if (handlerEx is null)
        {
            await HandleSuccessAsync(db, job, ct);
        }
        else
        {
            await HandleFailureAsync(db, job, handlerEx, ct);
        }
    }

    // ── Success ───────────────────────────────────────────────────────────────

    private async Task HandleSuccessAsync(AppDbContext db, Job job, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        int rows = await db.Jobs
            .Where(j => j.Id == job.Id && j.Status == JobStatus.Processing)
            .ExecuteUpdateAsync(s => s
                .SetProperty(j => j.Status, JobStatus.Succeeded)
                .SetProperty(j => j.CompletedAt, now)
                .SetProperty(j => j.LeaseExpiresAt, (DateTime?)null)
                .SetProperty(j => j.WorkerId, (string?)null)
                .SetProperty(j => j.IsCanary, false),
                ct);

        if (rows == 0)
        {
            log.LogWarning("Job {JobId} success update hit 0 rows (lease may have expired)", job.Id);
            return;
        }

        db.EventLogs.Add(new EventLog
        {
            At = now,
            Type = "JobSucceeded",
            JobId = job.Id,
            Dependency = job.Dependency,
            Message = $"Completed after {job.Attempts} prior failure(s)" + (job.IsCanary ? " [CANARY]" : "")
        });

        await db.SaveChangesAsync(ct);
        log.LogInformation("Job {JobId} ({Type}) SUCCEEDED", job.Id, job.Type);

        if (job.IsCanary)
        {
            await circuitBreaker.OnCanarySuccessAsync(job.Dependency, ct);
        }
    }

    // ── Failure ───────────────────────────────────────────────────────────────

    private async Task HandleFailureAsync(AppDbContext db, Job job, Exception ex, CancellationToken ct)
    {
        var now = DateTime.UtcNow;

        // 1. Canary failure handling
        if (job.IsCanary)
        {
            await circuitBreaker.OnCanaryFailureAsync(job.Dependency, ex, ct);
            return;
        }

        // 2. In-flight failure when circuit is Open or HalfOpen:
        // "once Open/HalfOpen, in-flight failures return Hold and do NOT increment Attempts and do NOT write a JobFailure row."
        var circuitState = circuitBreaker.GetState(job.Dependency);
        if (circuitState != CircuitState.Closed)
        {
            await db.Jobs
                .Where(j => j.Id == job.Id && j.Status == JobStatus.Processing)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(j => j.Status, JobStatus.Held)
                    .SetProperty(j => j.WorkerId, (string?)null)
                    .SetProperty(j => j.LeaseExpiresAt, (DateTime?)null)
                    .SetProperty(j => j.AttemptsSaved, j => j.AttemptsSaved + 1),
                    ct);

            db.EventLogs.Add(new EventLog
            {
                At = now,
                Type = "JobHeld",
                JobId = job.Id,
                Dependency = job.Dependency,
                Message = $"In-flight failure during {circuitState} circuit; job held without attempt penalty: [{ex.GetType().Name}] {ex.Message}"
            });

            await db.SaveChangesAsync(ct);
            log.LogInformation("Job {JobId} held due to {CircuitState} circuit on {Dependency}",
                job.Id, circuitState, job.Dependency);
            return;
        }

        // 3. Normal failure when circuit is Closed
        int newAttempts = job.Attempts + 1;
        string exType = ex.GetType().Name;
        string message = ex.Message;
        string stackTrace = ex.StackTrace ?? "";
        string fingerprint = Fingerprinter.Fingerprint(exType, message, stackTrace);

        // Write failure row
        db.JobFailures.Add(new JobFailure
        {
            JobId = job.Id,
            JobType = job.Type,
            Dependency = job.Dependency,
            Attempt = newAttempts,
            ExceptionType = exType,
            Message = message,
            StackTrace = stackTrace,
            Fingerprint = fingerprint,
            OccurredAt = now
        });

        // Write JobFailed event
        db.EventLogs.Add(new EventLog
        {
            At = now,
            Type = "JobFailed",
            JobId = job.Id,
            Dependency = job.Dependency,
            Message = $"Attempt {newAttempts}: [{exType}] {message}"
        });

        bool isDead = newAttempts > job.MaxRetries;

        if (isDead)
        {
            await HandleDeadAsync(db, job, newAttempts, fingerprint, message, now, ct);
        }
        else
        {
            await HandleRetryAsync(db, job, newAttempts, fingerprint, message, now, ct);
        }

        // Record failure in circuit breaker (may trip circuit to Open)
        await circuitBreaker.RecordFailureAsync(job.Dependency, ct);
    }

    private async Task HandleDeadAsync(
        AppDbContext db, Job job, int newAttempts, string fingerprint,
        string finalError, DateTime now, CancellationToken ct)
    {
        // Update job to Dead
        await db.Jobs
            .Where(j => j.Id == job.Id && j.Status == JobStatus.Processing)
            .ExecuteUpdateAsync(s => s
                .SetProperty(j => j.Status, JobStatus.Dead)
                .SetProperty(j => j.Attempts, newAttempts)
                .SetProperty(j => j.LastError, finalError)
                .SetProperty(j => j.LastFingerprint, fingerprint)
                .SetProperty(j => j.CompletedAt, now)
                .SetProperty(j => j.LeaseExpiresAt, (DateTime?)null)
                .SetProperty(j => j.WorkerId, (string?)null)
                .SetProperty(j => j.IsCanary, false),
                ct);

        // Write DeadLetter row
        db.DeadLetters.Add(new DeadLetter
        {
            JobId = job.Id,
            JobName = job.Name,
            JobType = job.Type,
            Attempts = newAttempts,
            FinalError = finalError,
            Fingerprint = fingerprint,
            FailedAt = now
        });

        db.EventLogs.Add(new EventLog
        {
            At = now,
            Type = "JobDeadLettered",
            JobId = job.Id,
            Dependency = job.Dependency,
            Message = $"Dead after {newAttempts} attempt(s). Fingerprint: {fingerprint}"
        });

        await db.SaveChangesAsync(ct);
        log.LogWarning("Job {JobId} ({Type}) DEAD after {Attempts} attempts", job.Id, job.Type, newAttempts);
    }

    private async Task HandleRetryAsync(
        AppDbContext db, Job job, int newAttempts, string fingerprint,
        string lastError, DateTime now, CancellationToken ct)
    {
        var delay = BackoffCalculator.Compute(
            newAttempts, _opts.BaseDelaySeconds, _opts.MaxDelaySeconds, _opts.JitterPercent);
        var nextRun = now.Add(delay);

        await db.Jobs
            .Where(j => j.Id == job.Id && j.Status == JobStatus.Processing)
            .ExecuteUpdateAsync(s => s
                .SetProperty(j => j.Status, JobStatus.Retrying)
                .SetProperty(j => j.Attempts, newAttempts)
                .SetProperty(j => j.LastError, lastError)
                .SetProperty(j => j.LastFingerprint, fingerprint)
                .SetProperty(j => j.NextRunAt, nextRun)
                .SetProperty(j => j.LeaseExpiresAt, (DateTime?)null)
                .SetProperty(j => j.WorkerId, (string?)null)
                .SetProperty(j => j.IsCanary, false),
                ct);

        db.EventLogs.Add(new EventLog
        {
            At = now,
            Type = "RetryScheduled",
            JobId = job.Id,
            Dependency = job.Dependency,
            Message = $"Retry {newAttempts}/{job.MaxRetries} in {delay.TotalSeconds:F1}s (next: {nextRun:O})"
        });

        await db.SaveChangesAsync(ct);
        log.LogInformation("Job {JobId} retry {Attempt}/{Max} in {Delay:F1}s",
            job.Id, newAttempts, job.MaxRetries, delay.TotalSeconds);
    }
}
