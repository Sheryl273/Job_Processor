namespace Jobs.Core.Entities;

public class DeadLetter
{
    public Guid Id { get; set; }
    public Guid JobId { get; set; }
    public string Type { get; set; } = "";
    public string Payload { get; set; } = "{}";
    public string FinalError { get; set; } = "";
    public int Attempts { get; set; }
    public DateTime FailedAt { get; set; }
}
