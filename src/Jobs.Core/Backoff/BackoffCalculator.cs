namespace Jobs.Core.Backoff;

public static class BackoffCalculator
{
    /// <summary>
    /// Full-jitter exponential backoff: random(0, min(base * 2^(attempt-1), max)).
    /// <paramref name="attempt"/> is the 1-based number of the attempt that just FAILED.
    /// Pass a seeded Random in tests.
    /// </summary>
    public static TimeSpan Compute(int attempt, TimeSpan baseDelay, TimeSpan maxDelay, Random? rng = null)
    {
        rng ??= Random.Shared;
        var ceiling = Ceiling(attempt, baseDelay, maxDelay);
        return TimeSpan.FromMilliseconds(rng.NextDouble() * ceiling.TotalMilliseconds);
    }

    /// <summary>Upper bound (no jitter) - handy for asserting in tests.</summary>
    public static TimeSpan Ceiling(int attempt, TimeSpan baseDelay, TimeSpan maxDelay)
    {
        if (attempt < 1) attempt = 1;
        var exp = baseDelay.TotalMilliseconds * Math.Pow(2, Math.Min(attempt - 1, 30));
        return TimeSpan.FromMilliseconds(Math.Min(exp, maxDelay.TotalMilliseconds));
    }
}
