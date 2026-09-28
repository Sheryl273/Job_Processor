using System.Collections.Concurrent;

namespace Api.Services;

/// <summary>
/// Thread-safe singleton that tracks which external dependencies are artificially
/// set "down" for demo/fault-injection purposes.
/// </summary>
public sealed class FaultInjector
{
    // dependency name -> (isDown, autoRestoreAt?)
    private readonly ConcurrentDictionary<string, (bool IsDown, DateTime? RestoreAt)> _state = new();

    public bool IsDown(string dependency)
    {
        if (dependency == "none") return false;
        if (!_state.TryGetValue(dependency, out var entry)) return false;

        // Auto-restore if a duration was specified
        if (entry.IsDown && entry.RestoreAt.HasValue && DateTime.UtcNow >= entry.RestoreAt.Value)
        {
            // CAS: only clear if no one else already updated it
            _state.TryUpdate(dependency, (false, null), entry);
            return false;
        }
        return entry.IsDown;
    }

    /// <summary>Set a dependency up or down. Pass durationSeconds to auto-restore.</summary>
    public void Set(string dependency, bool down, int? durationSeconds = null)
    {
        DateTime? restoreAt = (down && durationSeconds.HasValue)
            ? DateTime.UtcNow.AddSeconds(durationSeconds.Value)
            : null;
        _state[dependency] = (down, restoreAt);
    }

    /// <summary>Returns a snapshot of the current outage state for the /api/sim/state endpoint.</summary>
    public IReadOnlyDictionary<string, (bool IsDown, DateTime? RestoreAt)> Snapshot()
        => _state.ToDictionary(kv => kv.Key, kv => kv.Value);

    /// <summary>Clears all simulated outages (used by sim/reset).</summary>
    public void Reset() => _state.Clear();
}
