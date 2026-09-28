namespace Api.Data;

// ── Enums ────────────────────────────────────────────────────────────────────

public enum JobStatus { Queued, Processing, Retrying, Succeeded, Held, Dead }

/// <summary>Priority stored as int so ORDER BY Priority DESC works (High=2 > Normal=1 > Low=0).</summary>
public enum Priority { Low = 0, Normal = 1, High = 2 }

// ── Domain entities ──────────────────────────────────────────────────────────

public class Job
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public string Type { get; set; } = "";
    public Priority Priority { get; set; } = Priority.Normal;
    public int MaxRetries { get; set; } = 3;
    /// <summary>Counts FAILED attempts. Dead when Attempts > MaxRetries.</summary>
    public int Attempts { get; set; } = 0;
    public JobStatus Status { get; set; } = JobStatus.Queued;
    /// <summary>"none" when no external dependency.</summary>
    public string Dependency { get; set; } = "none";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime NextRunAt { get; set; } = DateTime.UtcNow;
    public DateTime? StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public DateTime? LeaseExpiresAt { get; set; }
    public string? WorkerId { get; set; }
    public bool IsCanary { get; set; } = false;
    public string? LastError { get; set; }
    public string? LastFingerprint { get; set; }
    /// <summary>Retry attempts saved by the HELD circuit-breaker feature.</summary>
    public int AttemptsSaved { get; set; } = 0;
    /// <summary>How many times the lease-reaper reclaimed this job.</summary>
    public int ReclaimCount { get; set; } = 0;
}

public class JobFailure
{
    public long Id { get; set; }
    public Guid JobId { get; set; }
    public string JobType { get; set; } = "";
    public string Dependency { get; set; } = "none";
    public int Attempt { get; set; }
    public string ExceptionType { get; set; } = "";
    public string Message { get; set; } = "";
    public string StackTrace { get; set; } = "";
    public string Fingerprint { get; set; } = "pending";
    public DateTime OccurredAt { get; set; } = DateTime.UtcNow;
}

public class DeadLetter
{
    public long Id { get; set; }
    public Guid JobId { get; set; }
    public string JobName { get; set; } = "";
    public string JobType { get; set; } = "";
    public int Attempts { get; set; }
    public string FinalError { get; set; } = "";
    public string Fingerprint { get; set; } = "";
    public DateTime FailedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ReplayedAt { get; set; }
}

public class EventLog
{
    public long Id { get; set; }
    public DateTime At { get; set; } = DateTime.UtcNow;
    public string Type { get; set; } = "";
    public Guid? JobId { get; set; }
    public string? Dependency { get; set; }
    public string Message { get; set; } = "";
}

public class Incident
{
    public long Id { get; set; }
    public string Dependency { get; set; } = "";
    public DateTime OpenedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ClosedAt { get; set; }
    public int JobsHeld { get; set; }
    public int AttemptsSaved { get; set; }
    public int CanaryAttempts { get; set; }
}
