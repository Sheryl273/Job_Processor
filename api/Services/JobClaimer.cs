using Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Api.Services;

/// <summary>
/// Singleton that atomically claims the next eligible job for a worker.
/// Uses SemaphoreSlim(1,1) so only one claim attempt is in-flight at a time,
/// preventing SQLite write contention.
/// Excludes blocked dependencies except IsCanary jobs.
/// Uses ExecuteUpdateAsync with WHERE Id AND Status IN (Queued, Retrying)
/// and checks rows affected == 1, with retry up to 5 times.
/// </summary>
public sealed class JobClaimer(
    IDbContextFactory<AppDbContext> factory,
    CircuitBreakerManager circuitBreaker,
    FaultInjector faults,
    IOptions<ProcessingOptions> opts,
    ILogger<JobClaimer> log)
{
    private readonly ProcessingOptions _opts = opts.Value;
    private readonly SemaphoreSlim _sem = new(1, 1);

    public async Task<Job?> ClaimNextAsync(string workerId, CancellationToken ct)
    {
        await _sem.WaitAsync(ct);
        try
        {
            return await TryClaimWithRetriesAsync(workerId, ct);
        }
        finally
        {
            _sem.Release();
        }
    }

    private async Task<Job?> TryClaimWithRetriesAsync(string workerId, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        const int maxAttempts = 5;

        for (int attempt = 0; attempt < maxAttempts; attempt++)
        {
            await using var db = await factory.CreateDbContextAsync(ct);

            // Blocked dependencies are those where circuit is not Closed OR fault injector is down
            var blockedDeps = circuitBreaker.KnownDependencies
                .Where(dep => circuitBreaker.GetState(dep) != CircuitState.Closed || faults.IsDown(dep))
                .ToList();

            // Candidate must be Queued or Retrying, NextRunAt <= now,
            // and must NOT be on a blocked dependency UNLESS it is a canary job.
            var candidate = await db.Jobs
                .Where(j => (j.Status == JobStatus.Queued || j.Status == JobStatus.Retrying)
                         && j.NextRunAt <= now
                         && (j.IsCanary || !blockedDeps.Contains(j.Dependency)))
                .OrderByDescending(j => j.Priority)
                .ThenBy(j => j.NextRunAt)
                .FirstOrDefaultAsync(ct);

            if (candidate is null) return null;

            // If candidate is a normal job for a dependency that just went down, trigger circuit open and re-check
            if (!candidate.IsCanary && candidate.Dependency != "none" && faults.IsDown(candidate.Dependency))
            {
                await circuitBreaker.OpenCircuitAsync(candidate.Dependency, ct);
                continue;
            }

            // Atomic claim: WHERE Id = candidate.Id AND Status IN (Queued, Retrying)
            var leaseExpires = now.AddSeconds(_opts.LeaseSeconds);
            int rows = await db.Jobs
                .Where(j => j.Id == candidate.Id
                         && (j.Status == JobStatus.Queued || j.Status == JobStatus.Retrying))
                .ExecuteUpdateAsync(s => s
                    .SetProperty(j => j.Status, JobStatus.Processing)
                    .SetProperty(j => j.WorkerId, workerId)
                    .SetProperty(j => j.StartedAt, now)
                    .SetProperty(j => j.LeaseExpiresAt, leaseExpires),
                    ct);

            if (rows == 0)
            {
                // Race lost – another worker claimed it; retry up to 5 times
                log.LogDebug("Worker {WorkerId}: claim race lost on job {JobId}, retrying ({Attempt}/{Max})",
                    workerId, candidate.Id, attempt + 1, maxAttempts);
                continue;
            }

            // Re-fetch with the updated values
            var claimed = await db.Jobs.AsNoTracking()
                .FirstOrDefaultAsync(j => j.Id == candidate.Id, ct);

            if (claimed is null) continue;

            // Write JobClaimed event
            db.EventLogs.Add(new EventLog
            {
                At = now,
                Type = "JobClaimed",
                JobId = claimed.Id,
                Dependency = claimed.Dependency,
                Message = $"Claimed by {workerId}" + (claimed.IsCanary ? " [CANARY]" : "")
            });
            await db.SaveChangesAsync(ct);

            log.LogDebug("Worker {WorkerId} claimed job {JobId} ({Type})", workerId, claimed.Id, claimed.Type);
            return claimed;
        }

        return null;
    }
}
