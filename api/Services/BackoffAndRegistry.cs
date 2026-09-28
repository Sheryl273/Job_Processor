namespace Api.Services;

public static class BackoffCalculator
{
    /// <summary>
    /// delay = min(MaxDelay, Base * 2^(Attempts-1)) with +/- JitterPercent%.
    /// <paramref name="attempts"/> = number of failed attempts so far (1-based after first failure).
    /// </summary>
    public static TimeSpan Compute(int attempts, int baseSeconds, int maxSeconds, int jitterPercent)
    {
        double exp = Math.Min(attempts - 1, 30);
        double baseMs = baseSeconds * 1000.0;
        double ceiling = Math.Min(maxSeconds * 1000.0, baseMs * Math.Pow(2, exp));

        double jitterFraction = jitterPercent / 100.0;
        double low  = ceiling * (1.0 - jitterFraction);
        double high = ceiling * (1.0 + jitterFraction);
        double ms   = low + Random.Shared.NextDouble() * (high - low);

        return TimeSpan.FromMilliseconds(Math.Max(0, ms));
    }
}

/// <summary>Worker state exposed for /api/sim/state.</summary>
public enum WorkerState { Idle, Busy, Dead }

public sealed record WorkerInfo(string WorkerId, WorkerState State, Guid? CurrentJobId, DateTime UpdatedAt);

/// <summary>
/// Singleton registry tracking per-worker state.
/// Also manages the pending crash-simulation flag for kill-worker.
/// </summary>
public sealed class WorkerRegistry
{
    private readonly Dictionary<string, WorkerInfo> _workers = new();
    private readonly object _lock = new();

    // Crash simulation ─ null = no pending crash; a specific workerId = target that worker;
    // "" (empty) = hit the next worker that claims a job.
    private string? _pendingCrashTarget = null;
    private bool _crashPending = false;

    // ── Worker state ──────────────────────────────────────────────────────────

    public void Update(string workerId, WorkerState state, Guid? currentJobId = null)
    {
        lock (_lock)
            _workers[workerId] = new WorkerInfo(workerId, state, currentJobId, DateTime.UtcNow);
    }

    public IReadOnlyList<WorkerInfo> GetAll()
    {
        lock (_lock) return [.. _workers.Values];
    }

    // ── Crash simulation ──────────────────────────────────────────────────────

    /// <summary>
    /// Request a crash. If target is null/empty the next worker to claim a job is hit.
    /// Returns false if a crash is already pending.
    /// </summary>
    public bool RequestCrash(string? targetWorkerId = null)
    {
        lock (_lock)
        {
            if (_crashPending) return false;
            _crashPending = true;
            _pendingCrashTarget = string.IsNullOrWhiteSpace(targetWorkerId) ? null : targetWorkerId;
            return true;
        }
    }

    /// <summary>
    /// Called by a worker after it claims a job: returns true if THIS worker should crash.
    /// Consumes the flag atomically.
    /// </summary>
    public bool ConsumeCrashIfTargeted(string workerId)
    {
        lock (_lock)
        {
            if (!_crashPending) return false;
            // targeted at a specific worker, or broadcast (null = any)
            if (_pendingCrashTarget != null && _pendingCrashTarget != workerId) return false;
            _crashPending = false;
            _pendingCrashTarget = null;
            return true;
        }
    }

    public bool IsCrashPending()
    {
        lock (_lock) return _crashPending;
    }

    // ── Reset ─────────────────────────────────────────────────────────────────

    public void Reset()
    {
        lock (_lock)
        {
            _crashPending = false;
            _pendingCrashTarget = null;
            // Worker entries stay; the workers keep running — just clear job refs
            var keys = _workers.Keys.ToList();
            foreach (var k in keys)
                _workers[k] = _workers[k] with { State = WorkerState.Idle, CurrentJobId = null };
        }
    }
}
