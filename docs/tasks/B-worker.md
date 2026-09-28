# Person B — Worker (`src/Jobs.Api/Worker`, `src/Jobs.Api/Handlers`)

Branch: `feat/b-worker` · Code against `IJobRepository`; use a fake in-memory implementation until A merges.

## Checklist
- [ ] Poll loop in `JobProcessorService` (`PollIntervalMs`), stops cleanly on shutdown
- [ ] Concurrency limited by `MaxConcurrency` (e.g. `SemaphoreSlim`)
- [ ] New DI scope per job (`IServiceScopeFactory`) because the repository is scoped
- [ ] Resolve handler by `job.Type`; unknown type → treat as failure with clear error
- [ ] Record a `JobAttempt` for every run (start, finish, success/error, stack trace)
- [ ] Success → `MarkSucceededAsync`
- [ ] Failure, `job.Attempts + 1 < job.MaxAttempts` → delay via `BackoffCalculator` → `MarkRetryAsync(retryAt)`
- [ ] Failure, attempts exhausted → `MoveToDeadLetterAsync`
- [ ] Periodically call `RecoverStaleAsync(StaleAfterSeconds)`
- [ ] Never crash the loop on an exception; log it and continue
- [ ] Handlers: `demo.succeed`, `demo.flaky`, `demo.always-fail` registered in `AddJobProcessing`
- [ ] Options bound from `JobProcessing` (already wired)

## Done when
Seeding jobs shows successes, retries with growing gaps between attempts, and dead letters after the configured retry count.
