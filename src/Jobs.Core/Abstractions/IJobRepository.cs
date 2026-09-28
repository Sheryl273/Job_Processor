using Jobs.Core.Entities;

namespace Jobs.Core.Abstractions;

public record PagedResult<T>(IReadOnlyList<T> Items, int Total, int Page, int PageSize);
public record JobStats(int Pending, int Processing, int Succeeded, int Retrying, int Dead);

/// <summary>THE shared contract. Implemented by Person A, used by B (worker) and C (API).</summary>
public interface IJobRepository
{
    // ---- producer / API side ----
    Task<Job> EnqueueAsync(string type, string payload, int? maxAttempts, CancellationToken ct);
    Task<Job?> GetAsync(Guid id, CancellationToken ct);
    Task<IReadOnlyList<JobAttempt>> GetAttemptsAsync(Guid jobId, CancellationToken ct);
    Task<PagedResult<Job>> ListAsync(JobStatus? status, int page, int pageSize, CancellationToken ct);
    Task<JobStats> GetStatsAsync(CancellationToken ct);
    Task<PagedResult<DeadLetter>> ListDeadLettersAsync(int page, int pageSize, CancellationToken ct);
    Task<bool> RequeueDeadLetterAsync(Guid deadLetterId, CancellationToken ct);

    // ---- worker side ----
    /// <summary>Atomically claim ONE due job (Pending/Retrying, RunAt &lt;= now) using FOR UPDATE SKIP LOCKED.
    /// Sets Status=Processing, LockedAt, LockedBy, ClaimToken. Returns null if nothing is due.</summary>
    Task<Job?> ClaimNextAsync(string workerId, CancellationToken ct);
    Task RecordAttemptAsync(JobAttempt attempt, CancellationToken ct);
    Task MarkSucceededAsync(Guid jobId, Guid claimToken, CancellationToken ct);
    /// <summary>Attempts++, Status=Retrying, RunAt=retryAt, LastError set, lock cleared.</summary>
    Task MarkRetryAsync(Guid jobId, Guid claimToken, DateTime retryAt, string error, CancellationToken ct);
    /// <summary>Status=Dead, insert dead_letters row, lock cleared. Must be one transaction.</summary>
    Task MoveToDeadLetterAsync(Guid jobId, Guid claimToken, string error, CancellationToken ct);
    /// <summary>Jobs stuck in Processing longer than timeout go back to Retrying. Returns count.</summary>
    Task<int> RecoverStaleAsync(TimeSpan timeout, CancellationToken ct);
}
