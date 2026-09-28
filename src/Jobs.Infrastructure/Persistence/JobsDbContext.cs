using Jobs.Core.Entities;
using Microsoft.EntityFrameworkCore;

namespace Jobs.Infrastructure.Persistence;

// OWNER: Person A. TODO: map tables (snake_case), jsonb payload, indexes on (status, run_at),
// then run: dotnet ef migrations add InitialCreate -p src/Jobs.Infrastructure -s src/Jobs.Api
public class JobsDbContext : DbContext
{
    public JobsDbContext(DbContextOptions<JobsDbContext> options) : base(options) { }

    public DbSet<Job> Jobs => Set<Job>();
    public DbSet<JobAttempt> JobAttempts => Set<JobAttempt>();
    public DbSet<DeadLetter> DeadLetters => Set<DeadLetter>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        // TODO(A): configure entities
    }
}
