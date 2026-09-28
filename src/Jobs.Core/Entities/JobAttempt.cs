namespace Jobs.Core.Entities;

public class JobAttempt
{
    public Guid Id { get; set; }
    public Guid JobId { get; set; }
    public int AttemptNo { get; set; }                    // 1-based
    public DateTime StartedAt { get; set; }
    public DateTime? FinishedAt { get; set; }
    public bool Succeeded { get; set; }
    public string? Error { get; set; }
    public string? StackTrace { get; set; }
}
