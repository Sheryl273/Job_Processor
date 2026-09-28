using Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Api.Services;

/// <summary>
/// Singleton that atomically claims the next eligible job for a worker.
/// Uses SemaphoreSlim(1,1) so only one claim attempt is in-flight at a time,
/// preventing SQLite write contention.
/// </summary>
public sealed class JobClaimer(
    IDbContextFactory<AppDbContext> factory,
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

            var downDeps = faults.Snapshot()
                .Where(kv => kv.Value.IsDown)
                .Select(kv => kv.Key)
                .ToList();

            // Candidate can be Queued, Retrying, or (Held if circuit is recovered / not down)
            var candidate = await db.Jobs
                .Where(j => (j.Status == JobStatus.Queued || j.Status == JobStatus.Retrying || (j.Status == JobStatus.Held && !downDeps.Contains(j.Dependency)))
                         && j.NextRunAt <= now)
                .OrderByDescending(j => j.Priority)
                .ThenBy(j => j.NextRunAt)
                .FirstOrDefaultAsync(ct);

            if (candidate is null) return null;

            // ── Circuit Breaker check ───────────────────────────────────────
            if (candidate.Dependency != "none" && faults.IsDown(candidate.Dependency) && !candidate.IsCanary)
            {
                // Bulk hold all Queued and Retrying jobs for this dependency
                int heldCount = await db.Jobs
                    .Where(j => j.Dependency == candidate.Dependency && (j.Status == JobStatus.Queued || j.Status == JobStatus.Retrying))
                    .ExecuteUpdateAsync(s => s
                        .SetProperty(j => j.Status, JobStatus.Held)
                        .SetProperty(j => j.AttemptsSaved, j => j.AttemptsSaved + 1), ct);

                if (heldCount > 0)
                {
                    db.EventLogs.Add(new EventLog
                    {
                        At = now,
                        Type = "CircuitOpened",
                        Dependency = candidate.Dependency,
                        Message = $"Circuit open for {candidate.Dependency}; {heldCount} jobs held to save retry attempts"
                    });
                    await db.SaveChangesAsync(ct);
                }
                return null;
            }

            // Atomic claim: WHERE Id = x AND Status IN (Queued, Retrying, Held)
            var leaseExpires = now.AddSeconds(_opts.LeaseSeconds);
            int rows = await db.Jobs
                .Where(j => j.Id == candidate.Id
                         && (j.Status == JobStatus.Queued || j.Status == JobStatus.Retrying || j.Status == JobStatus.Held))
                .ExecuteUpdateAsync(s => s
                    .SetProperty(j => j.Status, JobStatus.Processing)
                    .SetProperty(j => j.WorkerId, workerId)
                    .SetProperty(j => j.StartedAt, now)
                    .SetProperty(j => j.LeaseExpiresAt, leaseExpires),
                    ct);

            if (rows == 0)
            {
                // Race lost – another worker claimed it; retry
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
                Message = $"Claimed by {workerId}"
            });
            await db.SaveChangesAsync(ct);

            log.LogDebug("Worker {WorkerId} claimed job {JobId} ({Type})", workerId, claimed.Id, claimed.Type);
            return claimed;
        }

        log.LogWarning("Worker {WorkerId}: could not claim a job after {Max} attempts", workerId, maxAttempts);
        return null;
    }
}

