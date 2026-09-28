using Api.Data;
using Api.Services;
using Api.Workers;
using Microsoft.EntityFrameworkCore;

namespace Api.Endpoints;

public static class SimEndpoints
{
    public static IEndpointRouteBuilder MapSimEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api/sim");

        // ── POST /api/sim/enqueue ─────────────────────────────────────────────
        api.MapPost("/enqueue", async (
            SimEnqueueRequest req,
            IDbContextFactory<AppDbContext> factory,
            CancellationToken ct) =>
        {
            await using var db = await factory.CreateDbContextAsync(ct);
            var now = DateTime.UtcNow;
            var jobType = req.Type.ToUpperInvariant();
            var priority = Enum.TryParse<Priority>(req.Priority ?? "Normal", true, out var p) ? p : Priority.Normal;
            int count = Math.Clamp(req.Count ?? 1, 1, 500);

            var jobs = Enumerable.Range(1, count).Select(n => new Job
            {
                Id = Guid.NewGuid(),
                Name = $"{jobType} #{n}",
                Type = jobType,
                Priority = priority,
                MaxRetries = req.MaxRetries ?? 3,
                Status = JobStatus.Queued,
                Dependency = JobRegistry.GetDependency(jobType),
                CreatedAt = now,
                NextRunAt = now
            }).ToList();

            db.Jobs.AddRange(jobs);
            db.EventLogs.AddRange(jobs.Select(j => new EventLog
            {
                At = now,
                Type = "JobQueued",
                JobId = j.Id,
                Dependency = j.Dependency,
                Message = $"Bulk enqueued {j.Type} (priority {priority})"
            }));
            await db.SaveChangesAsync(ct);
            return Results.Ok(new { enqueued = count });
        });

        // ── POST /api/sim/outage ──────────────────────────────────────────────
        api.MapPost("/outage", async (
            SimOutageRequest req,
            FaultInjector faults,
            IDbContextFactory<AppDbContext> factory,
            CancellationToken ct) =>
        {
            faults.Set(req.Dependency, req.Down, req.DurationSeconds);

            await using var db = await factory.CreateDbContextAsync(ct);
            db.EventLogs.Add(new EventLog
            {
                At = DateTime.UtcNow,
                Type = req.Down ? "OutageStarted" : "OutageEnded",
                Dependency = req.Dependency,
                Message = req.Down
                    ? $"Outage started for {req.Dependency}"
                      + (req.DurationSeconds.HasValue ? $" (auto-recover in {req.DurationSeconds}s)" : "")
                    : $"Outage ended for {req.Dependency}"
            });
            await db.SaveChangesAsync(ct);

            // Auto-recover: fire-and-forget background Task.Delay + write OutageEnded event
            if (req.Down && req.DurationSeconds.HasValue)
            {
                var dep = req.Dependency;
                var secs = req.DurationSeconds.Value;
                _ = Task.Run(async () =>
                {
                    await Task.Delay(TimeSpan.FromSeconds(secs));
                    // FaultInjector auto-restores on IsDown() call, but also write an event
                    await using var db2 = await factory.CreateDbContextAsync(CancellationToken.None);
                    db2.EventLogs.Add(new EventLog
                    {
                        At = DateTime.UtcNow,
                        Type = "OutageEnded",
                        Dependency = dep,
                        Message = $"Auto-recovered for {dep} after {secs}s"
                    });
                    await db2.SaveChangesAsync(CancellationToken.None);
                });
            }

            return Results.Ok(new { dependency = req.Dependency, down = req.Down });
        });

        // ── GET /api/sim/state ────────────────────────────────────────────────
        api.MapGet("/state", (FaultInjector faults, WorkerRegistry workers) =>
        {
            var outages = faults.Snapshot().Select(kv => new
            {
                Dependency = kv.Key,
                IsDown = kv.Value.IsDown,
                EndsAt = kv.Value.RestoreAt
            }).ToList();

            var workerList = workers.GetAll().Select(w => new
            {
                Id = w.WorkerId,
                State = w.State.ToString(),
                CurrentJobId = w.CurrentJobId
            }).ToList();

            return Results.Ok(new { outages, workers = workerList });
        });

        // ── POST /api/sim/kill-worker ─────────────────────────────────────────
        api.MapPost("/kill-worker", (
            KillWorkerRequest? req,
            WorkerRegistry workers) =>
        {
            bool accepted = workers.RequestCrash(req?.WorkerId);
            return accepted
                ? Results.Ok(new { message = "Crash queued", target = req?.WorkerId ?? "next-to-claim" })
                : Results.Conflict(new { error = "A crash is already pending" });
        });

        // ── POST /api/sim/reset ───────────────────────────────────────────────
        api.MapPost("/reset", async (
            IDbContextFactory<AppDbContext> factory,
            FaultInjector faults,
            WorkerRegistry workers,
            CancellationToken ct) =>
        {
            await using var db = await factory.CreateDbContextAsync(ct);

            // Delete in dependency order (FK constraints)
            await db.EventLogs.ExecuteDeleteAsync(ct);
            await db.JobFailures.ExecuteDeleteAsync(ct);
            await db.DeadLetters.ExecuteDeleteAsync(ct);
            await db.Incidents.ExecuteDeleteAsync(ct);
            await db.Jobs.ExecuteDeleteAsync(ct);

            faults.Reset();
            workers.Reset();

            return Results.Ok(new { message = "Reset complete" });
        });

        return app;
    }
}

// ── Request DTOs ─────────────────────────────────────────────────────────────

public record SimEnqueueRequest(string Type, int? Count, int? MaxRetries, string? Priority);
public record SimOutageRequest(string Dependency, bool Down, int? DurationSeconds);
public record KillWorkerRequest(string? WorkerId);
