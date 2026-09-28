using Jobs.Core.Abstractions;
using Jobs.Core.Entities;
using Jobs.Infrastructure.Persistence;

namespace Jobs.Infrastructure.Repositories;

// OWNER: Person A. Implement every IJobRepository method.
// ClaimNextAsync MUST be one atomic statement (see docs/tasks/A-data.md for the SQL).
public class PostgresJobRepository : IJobRepository
{
    private readonly JobsDbContext _db;
    public PostgresJobRepository(JobsDbContext db) => _db = db;

    public Task<Job> EnqueueAsync(string type, string payload, int? maxAttempts, CancellationToken ct) => throw new NotImplementedException();
    public Task<Job?> GetAsync(Guid id, CancellationToken ct) => throw new NotImplementedException();
    public Task<IReadOnlyList<JobAttempt>> GetAttemptsAsync(Guid jobId, CancellationToken ct) => throw new NotImplementedException();
    public Task<PagedResult<Job>> ListAsync(JobStatus? status, int page, int pageSize, CancellationToken ct) => throw new NotImplementedException();
    public Task<JobStats> GetStatsAsync(CancellationToken ct) => throw new NotImplementedException();
    public Task<PagedResult<DeadLetter>> ListDeadLettersAsync(int page, int pageSize, CancellationToken ct) => throw new NotImplementedException();
    public Task<bool> RequeueDeadLetterAsync(Guid deadLetterId, CancellationToken ct) => throw new NotImplementedException();
    public Task<Job?> ClaimNextAsync(string workerId, CancellationToken ct) => throw new NotImplementedException();
    public Task RecordAttemptAsync(JobAttempt attempt, CancellationToken ct) => throw new NotImplementedException();
    public Task MarkSucceededAsync(Guid jobId, Guid claimToken, CancellationToken ct) => throw new NotImplementedException();
    public Task MarkRetryAsync(Guid jobId, Guid claimToken, DateTime retryAt, string error, CancellationToken ct) => throw new NotImplementedException();
    public Task MoveToDeadLetterAsync(Guid jobId, Guid claimToken, string error, CancellationToken ct) => throw new NotImplementedException();
    public Task<int> RecoverStaleAsync(TimeSpan timeout, CancellationToken ct) => throw new NotImplementedException();
}
