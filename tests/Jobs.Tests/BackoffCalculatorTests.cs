using Jobs.Core.Backoff;
using Xunit;

namespace Jobs.Tests;

// OWNER: Person C
public class BackoffCalculatorTests
{
    private static readonly TimeSpan Base = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan Max = TimeSpan.FromSeconds(60);

    [Theory]
    [InlineData(1, 1)]
    [InlineData(2, 2)]
    [InlineData(3, 4)]
    [InlineData(4, 8)]
    public void Ceiling_doubles_each_attempt(int attempt, int expectedSeconds)
        => Assert.Equal(TimeSpan.FromSeconds(expectedSeconds), BackoffCalculator.Ceiling(attempt, Base, Max));

    [Fact]
    public void Ceiling_is_capped_at_max()
        => Assert.Equal(Max, BackoffCalculator.Ceiling(20, Base, Max));

    [Fact]
    public void Jittered_delay_never_exceeds_ceiling()
    {
        var rng = new Random(42);
        for (var attempt = 1; attempt <= 10; attempt++)
        {
            var d = BackoffCalculator.Compute(attempt, Base, Max, rng);
            Assert.InRange(d, TimeSpan.Zero, BackoffCalculator.Ceiling(attempt, Base, Max));
        }
    }

    // TODO(C): add tests for retry exhaustion -> dead-letter once the worker exists.
}
