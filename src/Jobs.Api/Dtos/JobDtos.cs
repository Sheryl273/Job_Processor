namespace Jobs.Api.Dtos;

// OWNER: Person C. Shapes must match docs/CONTRACT.md exactly (Person D codes against them).
public record EnqueueJobRequest(string Type, System.Text.Json.JsonElement? Payload, int? MaxAttempts);
public record JobDto(Guid Id, string Type, string Status, int Attempts, int MaxAttempts, DateTime RunAt,
                     DateTime CreatedAt, DateTime? CompletedAt, string? LastError);
public record AttemptDto(int AttemptNo, DateTime StartedAt, DateTime? FinishedAt, bool Succeeded, string? Error, string? StackTrace);
public record JobDetailDto(JobDto Job, string Payload, IReadOnlyList<AttemptDto> AttemptHistory);
public record DeadLetterDto(Guid Id, Guid JobId, string Type, string Payload, string FinalError, int Attempts, DateTime FailedAt);
