# Person A — Data layer

**My role:** I own `src/Jobs.Infrastructure`. B (worker) and C (API) depend on my repository, so correctness and speed matter.

**Attached/pasted:** `docs/CONTRACT.md`, `src/Jobs.Core/Abstractions/IJobRepository.cs`, `src/Jobs.Core/Entities/*.cs`, `docs/tasks/A-data.md`, current `JobsDbContext.cs` and `PostgresJobRepository.cs`.

**Please produce, in this order:**
1. `JobsDbContext.OnModelCreating` mapping: snake_case table/column names, `Payload` as `jsonb`, `Status` stored as string (`HasConversion<string>()`), index on `(status, run_at)`, FK from `job_attempts.job_id` to `jobs.id`.
2. The EF Core CLI commands to create and apply the initial migration, and the `Database.Migrate()` startup snippet for development.
3. A full `PostgresJobRepository` implementing every method:
   - `ClaimNextAsync` as ONE atomic SQL statement using `FOR UPDATE SKIP LOCKED` (status IN Pending/Retrying, run_at <= now, ORDER BY run_at, LIMIT 1) that sets status Processing, locked_at, locked_by, claim_token and returns the row.
   - `MarkSucceeded/MarkRetry/MoveToDeadLetter` must verify `claim_token` matches (return quietly or throw a clear exception if it doesn't).
   - `MoveToDeadLetterAsync` in a single transaction.
   - `RecoverStaleAsync`, `RequeueDeadLetterAsync`, paging in `ListAsync`, and `GetStatsAsync` (single grouped query).
4. A small manual test plan: how to prove two concurrent claimers never get the same job.

**Constraints:** use `ExecuteSqlRaw`/`FromSqlRaw` with parameters (no string concatenation); UTC timestamps (`timestamptz`); no changes to `IJobRepository` signatures.
