namespace Jobs.Core.Entities;

public class Job
{
    public Guid Id { get; set; }
    public string Type { get; set; } = "";
    public string Payload { get; set; } = "{}";          // JSON
    public JobStatus Status { get; set; }
    public int Attempts { get; set; }                     // attempts already made
    public int MaxAttempts { get; set; }                  // = MaxRetryCount + 1
    public DateTime RunAt { get; set; }                   // UTC
    public DateTime? LockedAt { get; set; }
    public string? LockedBy { get; set; }
    public Guid? ClaimToken { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public string? LastError { get; set; }
}
