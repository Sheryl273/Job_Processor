using Api.Data;
using Api.Services;
using Microsoft.EntityFrameworkCore;

namespace Api.Endpoints;

public static class JobEndpoints
{
    public static IEndpointRouteBuilder MapJobEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api");

        // ── GET /api/health ───────────────────────────────────────────────────
        api.MapGet("/health", () => Results.Ok(new { status = "ok" }));

        // ── POST /api/jobs ────────────────────────────────────────────────────
        api.MapPost("/jobs", async (
            CreateJobRequest req,
            CircuitBreakerManager circuitBreaker,
            IDbContextFactory<AppDbContext> factory,
            CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(req.Type) || !JobRegistry.Dependencies.ContainsKey(req.Type))
            {
                return Results.BadRequest(new { error = $"Unknown job type '{req.Type}'" });
            }

            int maxRetries = req.MaxRetries ?? 3;
            if (maxRetries < 0 || maxRetries > 10)
            {
                return Results.BadRequest(new { error = "MaxRetries must be between 0 and 10" });
            }

            var dep = JobRegistry.GetDependency(req.Type);
            var circuitState = circuitBreaker.GetState(dep);
            bool shouldHold = circuitState != CircuitState.Closed;

            await using var db = await factory.CreateDbContextAsync(ct);
            var now = DateTime.UtcNow;
            var job = new Job
            {
                Id = Guid.NewGuid(),
                Name = string.IsNullOrWhiteSpace(req.Name) ? $"{req.Type} job" : req.Name,
                Type = req.Type.ToUpperInvariant(),
                Priority = Enum.TryParse<Priority>(req.Priority, true, out var p) ? p : Priority.Normal,
                MaxRetries = maxRetries,
                Status = shouldHold ? JobStatus.Held : JobStatus.Queued,
                AttemptsSaved = shouldHold ? 1 : 0,
                Dependency = dep,
                CreatedAt = now,
                NextRunAt = now
            };
            db.Jobs.Add(job);
            db.EventLogs.Add(new EventLog
            {
                At = now,
                Type = shouldHold ? "JobHeld" : "JobQueued",
                JobId = job.Id,
                Dependency = job.Dependency,
                Message = shouldHold
                    ? $"Created HELD for {job.Type} because circuit on {dep} is {circuitState}"
                    : $"Enqueued {job.Type} with priority {job.Priority}"
            });
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/jobs/{job.Id}", job);
        });

        // ── GET /api/jobs?status=&type=&take= ─────────────────────────────────
        api.MapGet("/jobs", async (
            string? status, string? type, int? take,
            IDbContextFactory<AppDbContext> factory, CancellationToken ct) =>
        {
            await using var db = await factory.CreateDbContextAsync(ct);
            var q = db.Jobs.AsNoTracking().AsQueryable();
            if (!string.IsNullOrWhiteSpace(status) &&
                Enum.TryParse<JobStatus>(status, true, out var s))
                q = q.Where(j => j.Status == s);
            if (!string.IsNullOrWhiteSpace(type))
                q = q.Where(j => j.Type == type.ToUpperInvariant());
            q = q.OrderByDescending(j => j.CreatedAt);
            if (take is > 0) q = q.Take(take.Value);
            return Results.Ok(await q.ToListAsync(ct));
        });

        // ── GET /api/jobs/dead-letter (must be BEFORE /{id:guid}) ────────────
        api.MapGet("/jobs/dead-letter", async (IDbContextFactory<AppDbContext> factory, CancellationToken ct) =>
        {
            await using var db = await factory.CreateDbContextAsync(ct);
            var rows = await db.DeadLetters.AsNoTracking()
                .Where(d => d.ReplayedAt == null)
                .OrderByDescending(d => d.FailedAt)
                .ToListAsync(ct);
            return Results.Ok(rows);
        });

        // ── GET /api/jobs/{id:guid} ───────────────────────────────────────────
        api.MapGet("/jobs/{id:guid}", async (Guid id, IDbContextFactory<AppDbContext> factory, CancellationToken ct) =>
        {
            await using var db = await factory.CreateDbContextAsync(ct);
            var job = await db.Jobs.AsNoTracking().FirstOrDefaultAsync(j => j.Id == id, ct);
            if (job is null) return Results.NotFound();
            var failures = await db.JobFailures.AsNoTracking()
                .Where(f => f.JobId == id).OrderBy(f => f.Attempt).ToListAsync(ct);
            var events = await db.EventLogs.AsNoTracking()
                .Where(e => e.JobId == id).OrderBy(e => e.At).ToListAsync(ct);
            return Results.Ok(new { job, failures, events });
        });

        // ── POST /api/jobs/{id:guid}/retry ────────────────────────────────────
        api.MapPost("/jobs/{id:guid}/retry", async (Guid id, IDbContextFactory<AppDbContext> factory, CancellationToken ct) =>
        {
            await using var db = await factory.CreateDbContextAsync(ct);
            var job = await db.Jobs.FirstOrDefaultAsync(j => j.Id == id, ct);
            if (job is null) return Results.NotFound();
            if (job.Status != JobStatus.Dead) return Results.Conflict(new { error = "Job is not Dead" });

            var now = DateTime.UtcNow;

            // Reset job
            await db.Jobs.Where(j => j.Id == id)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(j => j.Status, JobStatus.Queued)
                    .SetProperty(j => j.Attempts, 0)
                    .SetProperty(j => j.NextRunAt, now)
                    .SetProperty(j => j.CompletedAt, (DateTime?)null)
                    .SetProperty(j => j.LeaseExpiresAt, (DateTime?)null)
                    .SetProperty(j => j.WorkerId, (string?)null)
                    .SetProperty(j => j.IsCanary, false),
                    ct);

            // Mark dead-letter as replayed
            var dl = await db.DeadLetters
                .Where(d => d.JobId == id && d.ReplayedAt == null)
                .OrderByDescending(d => d.FailedAt)
                .FirstOrDefaultAsync(ct);
            if (dl is not null)
            {
                dl.ReplayedAt = now;
                await db.SaveChangesAsync(ct);
            }

            db.EventLogs.Add(new EventLog
            {
                At = now,
                Type = "JobReplayed",
                JobId = id,
                Message = "Manually retried from Dead state"
            });
            await db.SaveChangesAsync(ct);
            return Results.Ok(new { message = "Job requeued" });
        });

        // ── GET /api/stats ────────────────────────────────────────────────────
        api.MapGet("/stats", async (IDbContextFactory<AppDbContext> factory, CancellationToken ct) =>
        {
            await using var db = await factory.CreateDbContextAsync(ct);
            var stats = new
            {
                Total = await db.Jobs.CountAsync(ct),
                Queued = await db.Jobs.CountAsync(j => j.Status == JobStatus.Queued, ct),
                Processing = await db.Jobs.CountAsync(j => j.Status == JobStatus.Processing, ct),
                Retrying = await db.Jobs.CountAsync(j => j.Status == JobStatus.Retrying, ct),
                Held = await db.Jobs.CountAsync(j => j.Status == JobStatus.Held, ct),
                Succeeded = await db.Jobs.CountAsync(j => j.Status == JobStatus.Succeeded, ct),
                Dead = await db.Jobs.CountAsync(j => j.Status == JobStatus.Dead, ct),
                FailedAttempts = await db.Jobs.SumAsync(j => j.Attempts, ct),
                AttemptsSaved = await db.Jobs.SumAsync(j => j.AttemptsSaved, ct)
            };
            return Results.Ok(stats);
        });

        // ── GET /api/timeline?take=&jobId= ────────────────────────────────────
        api.MapGet("/timeline", async (
            int? take, Guid? jobId,
            IDbContextFactory<AppDbContext> factory, CancellationToken ct) =>
        {
            await using var db = await factory.CreateDbContextAsync(ct);
            var q = db.EventLogs.AsNoTracking().AsQueryable();
            if (jobId.HasValue) q = q.Where(e => e.JobId == jobId.Value);
            q = q.OrderByDescending(e => e.At);
            if (take is > 0) q = q.Take(take.Value);
            return Results.Ok(await q.ToListAsync(ct));
        });

        // ── GET /api/failure-groups ───────────────────────────────────────────
        api.MapGet("/failure-groups", async (IDbContextFactory<AppDbContext> factory, CancellationToken ct) =>
        {
            await using var db = await factory.CreateDbContextAsync(ct);

            // Load failures and unreplayed dead-letters into memory for grouping
            var failures = await db.JobFailures.AsNoTracking().ToListAsync(ct);
            var deadCounts = (await db.DeadLetters.AsNoTracking()
                    .Where(d => d.ReplayedAt == null)
                    .ToListAsync(ct))
                .GroupBy(d => d.Fingerprint)
                .ToDictionary(g => g.Key, g => g.Count());

            var groups = failures
                .GroupBy(f => f.Fingerprint)
                .Select(g =>
                {
                    var latest = g.OrderByDescending(f => f.OccurredAt).First();
                    return new
                    {
                        Fingerprint      = g.Key,
                        Title            = Fingerprinter.Title(latest.ExceptionType, latest.Message),
                        SampleMessage    = latest.Message,
                        Dependency       = g.Select(f => f.Dependency).FirstOrDefault(d => d != "none") ?? "none",
                        FailureCount     = g.Count(),
                        AffectedJobs     = g.Select(f => f.JobId).Distinct().Count(),
                        AffectedJobTypes = g.Select(f => f.JobType).Distinct().OrderBy(t => t).ToList(),
                        FirstSeen        = g.Min(f => f.OccurredAt),
                        LastSeen         = latest.OccurredAt,
                        DeadCount        = deadCounts.GetValueOrDefault(g.Key, 0)
                    };
                })
                .OrderByDescending(g => g.LastSeen)
                .ToList();

            return Results.Ok(groups);
        });

        // ── GET /api/blast-radius ─────────────────────────────────────────────
        api.MapGet("/blast-radius", async (
            IDbContextFactory<AppDbContext> factory,
            CircuitBreakerManager circuitBreaker,
            CancellationToken ct) =>
        {
            await using var db = await factory.CreateDbContextAsync(ct);
            var jobs = await db.Jobs.AsNoTracking().ToListAsync(ct);

            var dependencies = new[] { "payment-gateway", "email-provider", "report-database" };
            var depMap = new Dictionary<string, string[]>
            {
                ["payment-gateway"] = new[] { "PAYMENT" },
                ["email-provider"]   = new[] { "EMAIL" },
                ["report-database"]  = new[] { "REPORT" }
            };

            var result = dependencies.Select(dep =>
            {
                var depJobs = jobs.Where(j => j.Dependency == dep).ToList();
                var state = circuitBreaker.GetState(dep).ToString();
                int held = depJobs.Count(j => j.Status == JobStatus.Held);
                int queued = depJobs.Count(j => j.Status == JobStatus.Queued);
                int retrying = depJobs.Count(j => j.Status == JobStatus.Retrying);
                int dead = depJobs.Count(j => j.Status == JobStatus.Dead);
                int succeeded = depJobs.Count(j => j.Status == JobStatus.Succeeded);
                int attemptsSavedTotal = depJobs.Sum(j => j.AttemptsSaved);
                int totalAffected = held + retrying + dead;

                return new
                {
                    Dependency = dep,
                    CircuitState = state,
                    JobTypes = depMap.GetValueOrDefault(dep, Array.Empty<string>()),
                    Held = held,
                    Queued = queued,
                    Retrying = retrying,
                    Dead = dead,
                    Succeeded = succeeded,
                    TotalAffected = totalAffected,
                    AttemptsSavedTotal = attemptsSavedTotal
                };
            }).ToList();

            return Results.Ok(result);
        });

        // ── GET /api/circuits ─────────────────────────────────────────────────
        api.MapGet("/circuits", async (
            IDbContextFactory<AppDbContext> factory,
            CircuitBreakerManager circuitBreaker,
            CancellationToken ct) =>
        {
            await using var db = await factory.CreateDbContextAsync(ct);
            var dependencies = new[] { "payment-gateway", "email-provider", "report-database" };
            var windowStart = DateTime.UtcNow.AddSeconds(-60);

            var recentFailures = await db.JobFailures.AsNoTracking()
                .Where(f => f.OccurredAt >= windowStart)
                .ToListAsync(ct);

            var jobs = await db.Jobs.AsNoTracking()
                .Where(j => j.Dependency != "none")
                .ToListAsync(ct);

            var list = dependencies.Select(dep =>
            {
                var info = circuitBreaker.GetInfo(dep);
                var depJobs = jobs.Where(j => j.Dependency == dep).ToList();
                int failCount = recentFailures.Count(f => f.Dependency == dep);

                return new
                {
                    Dependency = dep,
                    State = info?.State.ToString() ?? "Closed",
                    FailureCount = failCount,
                    IncidentOpenedTime = info?.IncidentOpenedTime,
                    JobsHeld = depJobs.Count(j => j.Status == JobStatus.Held),
                    AttemptsSaved = depJobs.Sum(j => j.AttemptsSaved)
                };
            }).ToList();

            return Results.Ok(list);
        });

        // ── POST /api/dead-letter/{id}/replay ─────────────────────────────────
        api.MapPost("/dead-letter/{id:long}/replay", async (
            long id, IDbContextFactory<AppDbContext> factory, CancellationToken ct) =>
        {
            await using var db = await factory.CreateDbContextAsync(ct);
            var dl = await db.DeadLetters.FirstOrDefaultAsync(d => d.Id == id, ct);
            if (dl is null) return Results.NotFound();

            var job = await db.Jobs.FirstOrDefaultAsync(j => j.Id == dl.JobId, ct);
            if (job is null) return Results.NotFound(new { error = "Original job not found" });

            var now = DateTime.UtcNow;
            await db.Jobs.Where(j => j.Id == dl.JobId)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(j => j.Status, JobStatus.Queued)
                    .SetProperty(j => j.Attempts, 0)
                    .SetProperty(j => j.NextRunAt, now)
                    .SetProperty(j => j.CompletedAt, (DateTime?)null)
                    .SetProperty(j => j.LeaseExpiresAt, (DateTime?)null)
                    .SetProperty(j => j.WorkerId, (string?)null)
                    .SetProperty(j => j.IsCanary, false),
                    ct);

            dl.ReplayedAt = now;

            db.EventLogs.Add(new EventLog
            {
                At = now,
                Type = "JobReplayed",
                JobId = dl.JobId,
                Message = $"Replayed from dead-letter #{dl.Id}"
            });
            await db.SaveChangesAsync(ct);
            return Results.Ok(new { message = "Replayed" });
        });

        // ── POST /api/dead-letter/replay-group ────────────────────────────────
        api.MapPost("/dead-letter/replay-group", async (
            ReplayGroupRequest req, IDbContextFactory<AppDbContext> factory, CancellationToken ct) =>
        {
            await using var db = await factory.CreateDbContextAsync(ct);
            var now = DateTime.UtcNow;
            var letters = await db.DeadLetters
                .Where(d => d.Fingerprint == req.Fingerprint && d.ReplayedAt == null)
                .ToListAsync(ct);
            int count = 0;
            foreach (var dl in letters)
            {
                await db.Jobs.Where(j => j.Id == dl.JobId)
                    .ExecuteUpdateAsync(s => s
                        .SetProperty(j => j.Status, JobStatus.Queued)
                        .SetProperty(j => j.Attempts, 0)
                        .SetProperty(j => j.NextRunAt, now)
                        .SetProperty(j => j.CompletedAt, (DateTime?)null)
                        .SetProperty(j => j.LeaseExpiresAt, (DateTime?)null)
                        .SetProperty(j => j.WorkerId, (string?)null)
                        .SetProperty(j => j.IsCanary, false),
                        ct);
                dl.ReplayedAt = now;
                db.EventLogs.Add(new EventLog
                {
                    At = now,
                    Type = "JobReplayed",
                    JobId = dl.JobId,
                    Message = $"Group replay for fingerprint {req.Fingerprint}"
                });
                count++;
            }
            if (count > 0)
                await db.SaveChangesAsync(ct);

            return Results.Ok(new { replayed = count });
        });

        return app;
    }
}

// ── Request DTOs ─────────────────────────────────────────────────────────────

public record CreateJobRequest(string Name, string Type, string? Priority, int? MaxRetries);
public record ReplayGroupRequest(string Fingerprint);
