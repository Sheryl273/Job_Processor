using Jobs.Core.Options;
using Microsoft.Extensions.Options;

namespace Jobs.Api.Worker;

// OWNER: Person B.
// TODO(B): poll loop -> ClaimNextAsync -> resolve IJobHandler by Type -> RecordAttempt ->
//   success: MarkSucceeded | failure: backoff (BackoffCalculator) -> MarkRetry, or MoveToDeadLetter
//   when attempts exhausted. Respect MaxConcurrency, run RecoverStaleAsync periodically,
//   stop cleanly on cancellation. IJobRepository is scoped -> create a scope per job (IServiceScopeFactory).
public class JobProcessorService : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly JobProcessingOptions _opts;
    private readonly ILogger<JobProcessorService> _log;

    public JobProcessorService(IServiceScopeFactory scopes, IOptions<JobProcessingOptions> opts, ILogger<JobProcessorService> log)
    {
        _scopes = scopes; _opts = opts.Value; _log = log;
    }

    protected override Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _log.LogWarning("JobProcessorService is a stub - Person B to implement.");
        return Task.CompletedTask;
    }
}
