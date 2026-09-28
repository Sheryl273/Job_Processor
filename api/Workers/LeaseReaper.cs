using Api.Data;
using Api.Services;
using Microsoft.EntityFrameworkCore;

namespace Api.Workers;

/// <summary>
/// BackgroundService that ticks every 2 seconds to find Processing jobs whose lease
/// has expired, atomically reclaims them, and writes a LeaseExpired event.
/// Attempts are NOT incremented (a crash is not the job's fault).
/// If the job's dependency circuit is not Closed and the job is not a canary,
/// it is set to Held instead of Queued.
/// </summary>
public sealed class LeaseReaper(
    IDbContextFactory<AppDbContext> factory,
    CircuitBreakerManager circuitBreaker,
    ILogger<LeaseReaper> log) : BackgroundService
{
    private static readonly TimeSpan TickInterval = TimeSpan.FromSeconds(2);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        log.LogInformation("LeaseReaper started");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await TickAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                log.LogError(ex, "LeaseReaper tick failed");
            }

            try { await Task.Delay(TickInterval, stoppingToken); }
            catch (OperationCanceledException) { break; }
        }

        log.LogInformation("LeaseReaper stopped");
    }

    private async Task TickAsync(CancellationToken ct)
    {
        var now = DateTime.UtcNow;

        await using var db = await factory.CreateDbContextAsync(ct);

        // Find all expired-lease jobs in one read
        var expired = await db.Jobs
            .AsNoTracking()
            .Where(j => j.Status == JobStatus.Processing && j.LeaseExpiresAt < now)
            .ToListAsync(ct);

        if (expired.Count == 0) return;

        foreach (var job in expired)
        {
            var workerId = job.WorkerId ?? "unknown";
            var circuitState = circuitBreaker.GetState(job.Dependency);
            bool shouldHold = circuitState != CircuitState.Closed && !job.IsCanary;
            var targetStatus = shouldHold ? JobStatus.Held : JobStatus.Queued;

            // Atomically reclaim: Status must still be Processing AND lease still expired
            // Sets Status to Queued (or Held if circuit open), increments ReclaimCount, does NOT increment Attempts
            int rows = await db.Jobs
                .Where(j => j.Id == job.Id
                         && j.Status == JobStatus.Processing
                         && j.LeaseExpiresAt < now)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(j => j.Status, targetStatus)
                    .SetProperty(j => j.WorkerId, (string?)null)
                    .SetProperty(j => j.LeaseExpiresAt, (DateTime?)null)
                    .SetProperty(j => j.ReclaimCount, job.ReclaimCount + 1)
                    .SetProperty(j => j.AttemptsSaved, j => shouldHold ? j.AttemptsSaved + 1 : j.AttemptsSaved)
                    .SetProperty(j => j.NextRunAt, now),
                    ct);

            if (rows == 0)
            {
                continue;
            }

            db.EventLogs.Add(new EventLog
            {
                At = now,
                Type = "LeaseExpired",
                JobId = job.Id,
                Dependency = job.Dependency,
                Message = shouldHold
                    ? $"Lease expired; reclaimed and HELD because circuit is {circuitState} on {job.Dependency} (ReclaimCount={job.ReclaimCount + 1})"
                    : $"Lease expired; reclaimed from {workerId} to Queued (ReclaimCount={job.ReclaimCount + 1})"
            });

            log.LogWarning(
                "LeaseReaper reclaimed job {JobId} ({Type}) from worker {WorkerId} to {TargetStatus} (reclaim #{Count})",
                job.Id, job.Type, workerId, targetStatus, job.ReclaimCount + 1);
        }

        await db.SaveChangesAsync(ct);
    }
}
