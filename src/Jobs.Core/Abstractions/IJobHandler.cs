namespace Jobs.Core.Abstractions;

/// <summary>One handler per job Type. Throw to signal failure.</summary>
public interface IJobHandler
{
    string Type { get; }
    Task HandleAsync(string payload, CancellationToken ct);
}
