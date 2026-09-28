using Microsoft.EntityFrameworkCore;

namespace Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Job> Jobs => Set<Job>();
    public DbSet<JobFailure> JobFailures => Set<JobFailure>();
    public DbSet<DeadLetter> DeadLetters => Set<DeadLetter>();
    public DbSet<EventLog> EventLogs => Set<EventLog>();
    public DbSet<Incident> Incidents => Set<Incident>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        // ── Job ──────────────────────────────────────────────────────────────
        b.Entity<Job>(e =>
        {
            e.HasKey(j => j.Id);
            // Status stored as string
            e.Property(j => j.Status).HasConversion<string>();
            // Priority stored as int (can ORDER BY)
            e.Property(j => j.Priority).HasConversion<int>();
            e.HasIndex(j => j.Status);
            e.HasIndex(j => new { j.Status, j.NextRunAt });
        });

        // ── JobFailure ───────────────────────────────────────────────────────
        b.Entity<JobFailure>(e =>
        {
            e.HasKey(f => f.Id);
            e.HasIndex(f => f.JobId);
            e.HasIndex(f => f.Fingerprint);
        });

        // ── DeadLetter ───────────────────────────────────────────────────────
        b.Entity<DeadLetter>(e =>
        {
            e.HasKey(d => d.Id);
            e.HasIndex(d => d.JobId);
        });

        // ── EventLog ─────────────────────────────────────────────────────────
        b.Entity<EventLog>(e =>
        {
            e.HasKey(ev => ev.Id);
            e.HasIndex(ev => ev.At);
            e.HasIndex(ev => ev.JobId);
        });

        // ── Incident ─────────────────────────────────────────────────────────
        b.Entity<Incident>(e =>
        {
            e.HasKey(i => i.Id);
        });
    }
}
