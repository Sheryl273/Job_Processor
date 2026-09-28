using Jobs.Core.Abstractions;
using Jobs.Infrastructure.Persistence;
using Jobs.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Jobs.Infrastructure;

// OWNER: Person A
public static class InfrastructureServiceCollectionExtensions
{
    public static IServiceCollection AddJobsInfrastructure(this IServiceCollection services, IConfiguration config)
    {
        services.AddDbContext<JobsDbContext>(o => o.UseNpgsql(config.GetConnectionString("Jobs")));
        services.AddScoped<IJobRepository, PostgresJobRepository>();
        return services;
    }
}
