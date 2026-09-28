using Jobs.Core.Options;

namespace Jobs.Api.Worker;

// OWNER: Person B
public static class WorkerServiceCollectionExtensions
{
    public static IServiceCollection AddJobProcessing(this IServiceCollection services, IConfiguration config)
    {
        services.Configure<JobProcessingOptions>(config.GetSection(JobProcessingOptions.Section));
        services.AddHostedService<JobProcessorService>();
        // TODO(B): register IJobHandler implementations, e.g.
        // services.AddSingleton<IJobHandler, AlwaysSucceedsHandler>();
        return services;
    }
}
