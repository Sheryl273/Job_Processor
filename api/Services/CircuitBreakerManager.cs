using Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Api.Services;

public enum CircuitState
{
    Closed,
    Open,
    HalfOpen
}

public sealed class DependencyCircuitInfo
{
    public string Dependency { get; init; } = "";
    public CircuitState State { get; set; } = CircuitState.Closed;
    public DateTime? IncidentOpenedTime { get; set; }
    public long? CurrentIncidentId { get; set; }
    public Guid? ActiveCanaryJobId { get; set; }
    public List<DateTime> FailureTimestamps { get; } = [];
}

public sealed class CircuitBreakerManager(
    IDbContextFactory<AppDbContext> factory,
    FaultInjector faults,
    IOptions<CircuitOptions> opts,
    ILogger<CircuitBreakerManager> log)
{
    private readonly CircuitOptions _opts = opts.Value;
    private readonly object _lock = new();

    private readonly Dictionary<string, DependencyCircuitInfo> _circuits = new(StringComparer.OrdinalIgnoreCase)
    {
        ["payment-gateway"] = new() { Dependency = "payment-gateway" },
        ["email-provider"]   = new() { Dependency = "email-provider" },
        ["report-database"]  = new() { Dependency = "report-database" },
    };

    public CircuitState GetState(string dependency)
    {
        if (dependency == "none") return CircuitState.Closed;
        lock (_lock)
        {
            return _circuits.TryGetValue(dependency, out var info) ? info.State : CircuitState.Closed;
        }
    }

    public DependencyCircuitInfo? GetInfo(string dependency)
    {
        lock (_lock)
        {
            if (!_circuits.TryGetValue(dependency, out var info)) return null;
            return new DependencyCircuitInfo
            {
                Dependency = info.Dependency,
                State = info.State,
                IncidentOpenedTime = info.IncidentOpenedTime,
                CurrentIncidentId = info.CurrentIncidentId,
                ActiveCanaryJobId = info.ActiveCanaryJobId
            };
        }
    }

    public IReadOnlyList<string> KnownDependencies => _circuits.Keys.ToList();

    // ── Restore on Startup ───────────────────────────────────────────────────
    public async Task InitializeAsync(CancellationToken ct = default)
    {
        await using var db = await factory.CreateDbContextAsync(ct);
        var openIncidents = await db.Incidents
            .Where(i => i.ClosedAt == null)
            .OrderByDescending(i => i.OpenedAt)
            .ToListAsync(ct);

        lock (_lock)
        {
            foreach (var inc in openIncidents)
            {
                if (_circuits.TryGetValue(inc.Dependency, out var info))
                {
                    info.State = CircuitState.Open;
                    info.IncidentOpenedTime = inc.OpenedAt;
                    info.CurrentIncidentId = inc.Id;
                    log.LogWarning("Restored Open circuit for {Dependency} from unclosed incident #{IncidentId}",
                        inc.Dependency, inc.Id);
                }
            }
        }
    }

    // ── Failure Tracking ─────────────────────────────────────────────────────
    public async Task RecordFailureAsync(string dependency, CancellationToken ct = default)
    {
        if (dependency == "none") return;

        bool shouldOpen = false;
        DateTime now = DateTime.UtcNow;

        lock (_lock)
        {
            if (!_circuits.TryGetValue(dependency, out var info)) return;
            if (info.State != CircuitState.Closed) return;

            info.FailureTimestamps.Add(now);
            var cutoff = now.AddSeconds(-_opts.WindowSeconds);
            info.FailureTimestamps.RemoveAll(t => t < cutoff);

            if (info.FailureTimestamps.Count >= _opts.FailureThreshold || faults.IsDown(dependency))
            {
                shouldOpen = true;
            }
        }

        if (shouldOpen)
        {
            await OpenCircuitAsync(dependency, ct);
        }
    }

    // ── Open Circuit ─────────────────────────────────────────────────────────
    public async Task OpenCircuitAsync(string dependency, CancellationToken ct = default)
    {
        if (dependency == "none") return;
        DateTime now = DateTime.UtcNow;
        int heldCount = 0;

        await using var db = await factory.CreateDbContextAsync(ct);

        // Bulk hold all Queued and Retrying jobs in one transaction
        heldCount = await db.Jobs
            .Where(j => j.Dependency == dependency && (j.Status == JobStatus.Queued || j.Status == JobStatus.Retrying))
            .ExecuteUpdateAsync(s => s
                .SetProperty(j => j.Status, JobStatus.Held)
                .SetProperty(j => j.AttemptsSaved, j => j.AttemptsSaved + 1),
                ct);

        long incidentId = 0;
        lock (_lock)
        {
            if (!_circuits.TryGetValue(dependency, out var info))
            {
                info = new DependencyCircuitInfo { Dependency = dependency };
                _circuits[dependency] = info;
            }

            info.State = CircuitState.Open;
            info.IncidentOpenedTime = now;
            info.ActiveCanaryJobId = null;
            info.FailureTimestamps.Clear();
        }

        var incident = new Incident
        {
            Dependency = dependency,
            OpenedAt = now,
            JobsHeld = heldCount,
            AttemptsSaved = heldCount,
            CanaryAttempts = 0
        };
        db.Incidents.Add(incident);

        db.EventLogs.Add(new EventLog
        {
            At = now,
            Type = "CircuitOpened",
            Dependency = dependency,
            Message = $"Circuit OPENED for {dependency}. {heldCount} jobs held."
        });

        await db.SaveChangesAsync(ct);
        incidentId = incident.Id;

        lock (_lock)
        {
            if (_circuits.TryGetValue(dependency, out var info))
                info.CurrentIncidentId = incidentId;
        }

        log.LogWarning("Circuit OPENED for {Dependency} (incident #{IncidentId}, {HeldCount} held)",
            dependency, incidentId, heldCount);
    }

    // ── Check Cooldown & Trigger Canary (called by CircuitMonitor) ───────────
    public async Task CheckCooldownAsync(CancellationToken ct = default)
    {
        DateTime now = DateTime.UtcNow;
        List<string> depsToCheck;

        lock (_lock)
        {
            depsToCheck = _circuits.Values
                .Where(c => c.State == CircuitState.Open && c.IncidentOpenedTime.HasValue
                         && now >= c.IncidentOpenedTime.Value.AddSeconds(_opts.CooldownSeconds))
                .Select(c => c.Dependency)
                .ToList();
        }

        foreach (var dep in depsToCheck)
        {
            await TransitionToHalfOpenAsync(dep, ct);
        }
    }

    public async Task TransitionToHalfOpenAsync(string dependency, CancellationToken ct = default)
    {
        DateTime now = DateTime.UtcNow;
        await using var db = await factory.CreateDbContextAsync(ct);

        // Check if any held jobs exist for this dependency
        var heldJobs = await db.Jobs
            .Where(j => j.Dependency == dependency && j.Status == JobStatus.Held)
            .OrderByDescending(j => j.Priority)
            .ThenBy(j => j.CreatedAt)
            .Take(1)
            .ToListAsync(ct);

        if (heldJobs.Count == 0)
        {
            // No held jobs exist: close immediately
            log.LogInformation("HalfOpen check for {Dependency}: no Held jobs found, closing circuit immediately.", dependency);
            await CloseCircuitAsync(dependency, ct);
            return;
        }

        // Send exactly ONE canary
        var canary = heldJobs[0];

        lock (_lock)
        {
            if (!_circuits.TryGetValue(dependency, out var info)) return;
            info.State = CircuitState.HalfOpen;
            info.ActiveCanaryJobId = canary.Id;
        }

        int rows = await db.Jobs
            .Where(j => j.Id == canary.Id && j.Status == JobStatus.Held)
            .ExecuteUpdateAsync(s => s
                .SetProperty(j => j.Status, JobStatus.Queued)
                .SetProperty(j => j.IsCanary, true)
                .SetProperty(j => j.NextRunAt, now),
                ct);

        if (rows > 0)
        {
            db.EventLogs.Add(new EventLog
            {
                At = now,
                Type = "CircuitHalfOpened",
                Dependency = dependency,
                JobId = canary.Id,
                Message = $"Circuit HALF-OPEN for {dependency}. Dispatched canary job {canary.Id}."
            });
            await db.SaveChangesAsync(ct);
            log.LogInformation("Dispatched canary job {JobId} for {Dependency}", canary.Id, dependency);
        }
    }

    // ── Canary Result Handlers ────────────────────────────────────────────────
    public async Task OnCanarySuccessAsync(string dependency, CancellationToken ct = default)
    {
        log.LogInformation("Canary for {Dependency} SUCCEEDED. Closing circuit.", dependency);
        await CloseCircuitAsync(dependency, ct);
    }

    public async Task OnCanaryFailureAsync(string dependency, Exception ex, CancellationToken ct = default)
    {
        DateTime now = DateTime.UtcNow;
        log.LogWarning("Canary for {Dependency} FAILED: {Message}. Reopening circuit.", dependency, ex.Message);

        await using var db = await factory.CreateDbContextAsync(ct);

        long? currentIncId;
        Guid? canaryJobId;
        lock (_lock)
        {
            if (!_circuits.TryGetValue(dependency, out var info)) return;
            info.State = CircuitState.Open;
            info.IncidentOpenedTime = now; // restart cooldown
            currentIncId = info.CurrentIncidentId;
            canaryJobId = info.ActiveCanaryJobId;
            info.ActiveCanaryJobId = null;
        }

        if (currentIncId.HasValue)
        {
            await db.Incidents
                .Where(i => i.Id == currentIncId.Value)
                .ExecuteUpdateAsync(s => s.SetProperty(i => i.CanaryAttempts, i => i.CanaryAttempts + 1), ct);
        }

        if (canaryJobId.HasValue)
        {
            // Reset canary job back to Held
            await db.Jobs
                .Where(j => j.Id == canaryJobId.Value)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(j => j.Status, JobStatus.Held)
                    .SetProperty(j => j.IsCanary, false), ct);
        }

        db.EventLogs.Add(new EventLog
        {
            At = now,
            Type = "CircuitReopened",
            Dependency = dependency,
            JobId = canaryJobId,
            Message = $"Canary failed: [{ex.GetType().Name}] {ex.Message}. Circuit REOPENED for {dependency}."
        });

        await db.SaveChangesAsync(ct);
    }

    // ── Close Circuit & Staggered Release ─────────────────────────────────────
    public async Task CloseCircuitAsync(string dependency, CancellationToken ct = default)
    {
        if (dependency == "none") return;
        DateTime now = DateTime.UtcNow;

        long? currentIncId;
        lock (_lock)
        {
            if (!_circuits.TryGetValue(dependency, out var info)) return;
            info.State = CircuitState.Closed;
            info.IncidentOpenedTime = null;
            currentIncId = info.CurrentIncidentId;
            info.CurrentIncidentId = null;
            info.ActiveCanaryJobId = null;
            info.FailureTimestamps.Clear();
        }

        await using var db = await factory.CreateDbContextAsync(ct);

        if (currentIncId.HasValue)
        {
            await db.Incidents
                .Where(i => i.Id == currentIncId.Value && i.ClosedAt == null)
                .ExecuteUpdateAsync(s => s.SetProperty(i => i.ClosedAt, now), ct);
        }

        // Release ALL Held jobs staggered: index * 50ms, ordered by Priority DESC then CreatedAt ASC
        var heldJobs = await db.Jobs
            .Where(j => j.Dependency == dependency && j.Status == JobStatus.Held)
            .OrderByDescending(j => j.Priority)
            .ThenBy(j => j.CreatedAt)
            .ToListAsync(ct);

        for (int i = 0; i < heldJobs.Count; i++)
        {
            var job = heldJobs[i];
            var staggeredTime = now.AddMilliseconds(i * 50);
            await db.Jobs
                .Where(j => j.Id == job.Id && j.Status == JobStatus.Held)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(j => j.Status, JobStatus.Queued)
                    .SetProperty(j => j.IsCanary, false)
                    .SetProperty(j => j.NextRunAt, staggeredTime),
                    ct);
        }

        db.EventLogs.Add(new EventLog
        {
            At = now,
            Type = "CircuitClosed",
            Dependency = dependency,
            Message = $"Circuit CLOSED for {dependency}. Released {heldJobs.Count} held jobs (staggered 50ms)."
        });

        await db.SaveChangesAsync(ct);
        log.LogInformation("Circuit CLOSED for {Dependency}. Released {Count} jobs staggered.", dependency, heldJobs.Count);
    }

    // ── Reset ─────────────────────────────────────────────────────────────────
    public void Reset()
    {
        lock (_lock)
        {
            foreach (var c in _circuits.Values)
            {
                c.State = CircuitState.Closed;
                c.IncidentOpenedTime = null;
                c.CurrentIncidentId = null;
                c.ActiveCanaryJobId = null;
                c.FailureTimestamps.Clear();
            }
        }
    }
}
