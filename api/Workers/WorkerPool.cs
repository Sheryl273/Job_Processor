using Api.Data;
using Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Api.Workers;

/// <summary>
/// BackgroundService that spawns WorkerCount independent polling loops.
/// Each loop: claim -> heartbeat + run -> repeat. Null claim -> short poll delay.
/// Crash simulation: if WorkerRegistry signals a crash, the worker abandons the
/// job (no result written) and marks itself Dead for CrashDownSeconds before resuming.
/// </summary>
public sealed class WorkerPool(
    JobClaimer claimer,
    JobRunner runner,
    WorkerRegistry registry,
    IDbContextFactory<AppDbContext> factory,
    IOptions<ProcessingOptions> opts,
    ILogger<WorkerPool> log) : BackgroundService
{
    private readonly ProcessingOptions _opts = opts.Value;
    private const int CrashDownSeconds = 12;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var tasks = Enumerable.Range(1, _opts.WorkerCount)
            .Select(i => RunWorkerAsync($"worker-{i}", stoppingToken))
            .ToArray();

        await Task.WhenAll(tasks);
    }

    private async Task RunWorkerAsync(string workerId, CancellationToken ct)
    {
        registry.Update(workerId, WorkerState.Idle);
        log.LogInformation("Worker {WorkerId} started", workerId);

        while (!ct.IsCancellationRequested)
        {
            try
            {
                var job = await claimer.ClaimNextAsync(workerId, ct);

                if (job is null)
                {
                    registry.Update(workerId, WorkerState.Idle);
                    await Task.Delay(_opts.PollMs, ct);
                    continue;
                }

                // ── Crash simulation check ────────────────────────────────────
                if (registry.ConsumeCrashIfTargeted(workerId))
                {
                    await SimulateCrashAsync(workerId, job.Id, ct);
                    continue;
                }

                // ── Normal execution with heartbeat ───────────────────────────
                registry.Update(workerId, WorkerState.Busy, job.Id);

                using var jobCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                var heartbeatTask = RunHeartbeatAsync(workerId, job.Id, jobCts.Token);

                try
                {
                    await runner.ExecuteAsync(job, workerId, ct);
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested)
                {
                    await jobCts.CancelAsync();
                    break;
                }
                catch (Exception ex)
                {
                    log.LogError(ex, "Worker {WorkerId}: unhandled exception running job {JobId}",
                        workerId, job.Id);
                }
                finally
                {
                    // Always cancel the heartbeat when the job ends
                    await jobCts.CancelAsync();
                    try { await heartbeatTask; } catch { /* ignore cancellation */ }
                }

                registry.Update(workerId, WorkerState.Idle);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                log.LogError(ex, "Worker {WorkerId}: unexpected error in poll loop", workerId);
                registry.Update(workerId, WorkerState.Idle);
                try { await Task.Delay(_opts.PollMs, ct); }
                catch (OperationCanceledException) { break; }
            }
        }

        registry.Update(workerId, WorkerState.Dead);
        log.LogInformation("Worker {WorkerId} stopped", workerId);
    }

    // ── Heartbeat ─────────────────────────────────────────────────────────────

    /// <summary>
    /// Companion task: every HeartbeatSeconds extend LeaseExpiresAt for the running job.
    /// Stops automatically when the job finishes (jobCt is cancelled).
    /// </summary>
    private async Task RunHeartbeatAsync(string workerId, Guid jobId, CancellationToken jobCt)
    {
        try
        {
            while (!jobCt.IsCancellationRequested)
            {
                await Task.Delay(TimeSpan.FromSeconds(_opts.HeartbeatSeconds), jobCt);

                if (jobCt.IsCancellationRequested) break;

                await using var db = await factory.CreateDbContextAsync(jobCt);
                var newLease = DateTime.UtcNow.AddSeconds(_opts.LeaseSeconds);
                await db.Jobs
                    .Where(j => j.Id == jobId
                             && j.Status == JobStatus.Processing
                             && j.WorkerId == workerId)
                    .ExecuteUpdateAsync(s => s.SetProperty(j => j.LeaseExpiresAt, newLease), jobCt);

                log.LogDebug("Heartbeat extended lease for job {JobId} to {NewLease}", jobId, newLease);
            }
        }
        catch (OperationCanceledException)
        {
            // Expected when job ends — exit cleanly
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "Heartbeat for job {JobId} encountered an error", jobId);
        }
    }

    // ── Crash simulation ──────────────────────────────────────────────────────

    /// <summary>
    /// Worker "crashes": marks itself Dead, writes a WorkerCrashed event, and abandons
    /// the claimed job entirely (no result written). The lease will expire naturally and
    /// LeaseReaper will reclaim the job. After CrashDownSeconds the worker returns to Idle.
    /// </summary>
    private async Task SimulateCrashAsync(string workerId, Guid jobId, CancellationToken ct)
    {
        log.LogWarning("Worker {WorkerId} CRASH-SIMULATED — abandoning job {JobId}", workerId, jobId);
        registry.Update(workerId, WorkerState.Dead, jobId);

        try
        {
            await using var db = await factory.CreateDbContextAsync(CancellationToken.None);
            db.EventLogs.Add(new EventLog
            {
                At = DateTime.UtcNow,
                Type = "WorkerCrashed",
                JobId = jobId,
                Message = $"{workerId} crash-simulated; job {jobId} abandoned (lease will expire)"
            });
            await db.SaveChangesAsync(CancellationToken.None);
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Could not write WorkerCrashed event");
        }

        // Stay Dead for CrashDownSeconds, then return to Idle and resume
        try { await Task.Delay(TimeSpan.FromSeconds(CrashDownSeconds), ct); }
        catch (OperationCanceledException) { return; }

        registry.Update(workerId, WorkerState.Idle);
        log.LogInformation("Worker {WorkerId} recovered from crash simulation", workerId);
    }
}
