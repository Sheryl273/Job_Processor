namespace Jobs.Core.Entities;

public enum JobStatus
{
    Pending = 0,     // waiting to run (RunAt <= now)
    Processing = 1,  // claimed by a worker
    Succeeded = 2,
    Retrying = 3,    // failed, scheduled for a later attempt (RunAt in future)
    Dead = 4         // retries exhausted, copied to dead_letters
}
