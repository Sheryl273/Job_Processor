namespace Jobs.Core.Options;

/// <summary>Bound from appsettings.json section "JobProcessing".</summary>
public class JobProcessingOptions
{
    public const string Section = "JobProcessing";

    /// <summary>Retries AFTER the first attempt. MaxAttempts = MaxRetryCount + 1.</summary>
    public int MaxRetryCount { get; set; } = 5;
    public int BaseDelayMs { get; set; } = 1000;
    public int MaxDelayMs { get; set; } = 60000;
    public int PollIntervalMs { get; set; } = 1000;
    public int MaxConcurrency { get; set; } = 4;
    public int StaleAfterSeconds { get; set; } = 300;
}
