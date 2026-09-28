namespace Api.Services;

// ── Custom exceptions ────────────────────────────────────────────────────────

public sealed class DependencyUnavailableException(string dependency)
    : Exception($"{dependency} unavailable (503)")
{
    public string Dependency { get; } = dependency;
}

public sealed class TransientException(string message) : Exception(message);

// ── Job type / dependency registry ──────────────────────────────────────────

public static class JobRegistry
{
    public static readonly IReadOnlyDictionary<string, string> Dependencies =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["PAYMENT"]     = "payment-gateway",
            ["EMAIL"]       = "email-provider",
            ["REPORT"]      = "report-database",
            ["FLAKY"]       = "none",
            ["ALWAYS_FAIL"] = "none",
        };

    public static string GetDependency(string type)
        => Dependencies.TryGetValue(type, out var dep) ? dep : "none";
}

// ── Handlers ────────────────────────────────────────────────────────────────

public interface IJobHandler
{
    string Type { get; }
    Task HandleAsync(Guid jobId, CancellationToken ct);
}

public sealed class PaymentHandler(FaultInjector faults) : IJobHandler
{
    public string Type => "PAYMENT";

    public async Task HandleAsync(Guid jobId, CancellationToken ct)
    {
        if (faults.IsDown("payment-gateway"))
            throw new DependencyUnavailableException("payment-gateway");
        await Task.Delay(800, ct);
    }
}

public sealed class EmailHandler(FaultInjector faults) : IJobHandler
{
    public string Type => "EMAIL";

    public async Task HandleAsync(Guid jobId, CancellationToken ct)
    {
        if (faults.IsDown("email-provider"))
            throw new DependencyUnavailableException("email-provider");
        await Task.Delay(500, ct);
    }
}

public sealed class ReportHandler(FaultInjector faults) : IJobHandler
{
    public string Type => "REPORT";

    public async Task HandleAsync(Guid jobId, CancellationToken ct)
    {
        if (faults.IsDown("report-database"))
            throw new DependencyUnavailableException("report-database");
        await Task.Delay(1200, ct);
    }
}

public sealed class FlakyHandler : IJobHandler
{
    public string Type => "FLAKY";

    public async Task HandleAsync(Guid jobId, CancellationToken ct)
    {
        await Task.Delay(300, ct);
        // ~50% failure rate
        if (Random.Shared.NextDouble() < 0.5)
            throw new TransientException("Transient flake – please retry");
    }
}

public sealed class AlwaysFailHandler : IJobHandler
{
    public string Type => "ALWAYS_FAIL";

    public async Task HandleAsync(Guid jobId, CancellationToken ct)
    {
        await Task.Delay(200, ct);
        var orderNo = Random.Shared.Next(10000, 99999);
        throw new InvalidOperationException(
            $"NullReference in InvoiceMapper for order {orderNo}");
    }
}

// ── Handler dispatcher ───────────────────────────────────────────────────────

/// <summary>Resolves the correct IJobHandler for a given job type.</summary>
public sealed class HandlerRegistry(IEnumerable<IJobHandler> handlers)
{
    private readonly IReadOnlyDictionary<string, IJobHandler> _map =
        handlers.ToDictionary(h => h.Type, StringComparer.OrdinalIgnoreCase);

    public IJobHandler Get(string type)
        => _map.TryGetValue(type, out var h)
            ? h
            : throw new InvalidOperationException($"No handler registered for job type '{type}'");
}
