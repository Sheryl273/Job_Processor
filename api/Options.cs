namespace Api;

public class ProcessingOptions
{
    public const string Section = "Processing";
    public int WorkerCount { get; set; } = 3;
    public int BaseDelaySeconds { get; set; } = 1;
    public int MaxDelaySeconds { get; set; } = 30;
    public int JitterPercent { get; set; } = 20;
    public int LeaseSeconds { get; set; } = 10;
    public int HeartbeatSeconds { get; set; } = 3;
    public int PollMs { get; set; } = 250;
}

public class CircuitOptions
{
    public const string Section = "Circuit";
    public int FailureThreshold { get; set; } = 5;
    public int WindowSeconds { get; set; } = 20;
    public int CooldownSeconds { get; set; } = 12;
}
