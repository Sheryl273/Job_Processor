# Person B — Worker

**My role:** I own `src/Jobs.Api/Worker` and `src/Jobs.Api/Handlers`. The repository (Person A) may not be ready, so I need to develop against `IJobRepository` first.

**Attached/pasted:** `docs/CONTRACT.md`, `IJobRepository.cs`, `IJobHandler.cs`, `JobProcessingOptions.cs`, `BackoffCalculator.cs`, `docs/tasks/B-worker.md`, current `JobProcessorService.cs` and `WorkerServiceCollectionExtensions.cs`.

**Please produce:**
1. A complete `JobProcessorService : BackgroundService`:
   - poll loop using `PollIntervalMs`, graceful shutdown
   - concurrency capped by `MaxConcurrency`
   - new DI scope per job (repository is scoped)
   - handler lookup by `job.Type` (unknown type = failure with a clear message)
   - a `JobAttempt` recorded for every run (start, finish, success, error, stack trace)
   - success → `MarkSucceededAsync`
   - failure with retries left (`job.Attempts + 1 < job.MaxAttempts`) → compute delay with `BackoffCalculator.Compute` → `MarkRetryAsync`
   - failure with no retries left → `MoveToDeadLetterAsync`
   - periodic `RecoverStaleAsync`
   - loop must never die from an exception
2. Three handlers: `demo.succeed` (delay ~1s), `demo.flaky` (~60% failure), `demo.always-fail`. Registration lines for `AddJobProcessing`.
3. A tiny in-memory `FakeJobRepository` (test-only, in `tests/`) so I can test the worker before Person A finishes.
4. Logging that makes the demo readable (job id, type, attempt n/max, next retry delay).

**Constraints:** don't change the `IJobRepository` contract; separate the "decide what to do after failure" logic into a small pure method so Person C can unit test it.
