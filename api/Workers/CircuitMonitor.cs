using Api.Services;

namespace Api.Workers;

/// <summary>
/// BackgroundService that periodically inspects CircuitBreaker state.
/// When an Open circuit exceeds its CooldownSeconds, it moves the circuit to HalfOpen,
/// sends exactly ONE canary job, or closes immediately if no Held jobs exist.
/// </summary>
public sealed class CircuitMonitor(
    CircuitBreakerManager circuitBreaker,
    ILogger<CircuitMonitor> log) : BackgroundService
{
    private static readonly TimeSpan CheckInterval = TimeSpan.FromSeconds(1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        log.LogInformation("CircuitMonitor started");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await circuitBreaker.CheckCooldownAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                log.LogError(ex, "CircuitMonitor check encountered an error");
            }

            try
            {
                await Task.Delay(CheckInterval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }

        log.LogInformation("CircuitMonitor stopped");
    }
}
