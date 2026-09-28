# Person A — Data layer (`src/Jobs.Infrastructure`)

Branch: `feat/a-data` · You unblock B and C, so push a working repository EARLY (target: 0:50).

## Checklist
- [ ] `docker compose up -d db` works
- [ ] Map entities in `JobsDbContext` (snake_case, `payload` as jsonb, index `(status, run_at)`)
- [ ] `dotnet ef migrations add InitialCreate` and apply on startup (`Database.Migrate()` in dev) — coordinate the Program.cs line with C
- [ ] Implement `PostgresJobRepository` — every method in `IJobRepository`
- [ ] `ClaimNextAsync` atomic with `FOR UPDATE SKIP LOCKED` (below)
- [ ] `MarkSucceeded/MarkRetry/MoveToDeadLetter` only succeed if `claim_token` matches
- [ ] `MoveToDeadLetterAsync` in ONE transaction (update job + insert dead_letters)
- [ ] `RecoverStaleAsync`: Processing + locked_at older than timeout → Retrying, run_at = now
- [ ] `RequeueDeadLetterAsync`: job → Pending, attempts = 0, run_at = now
- [ ] Quick manual test: enqueue 3 jobs, claim from two parallel callers, confirm no duplicates

## Claim SQL (use `FromSqlRaw` / `ExecuteSqlRaw`, single statement)
```sql
UPDATE jobs SET status = 'Processing', locked_at = now(), locked_by = @worker, claim_token = gen_random_uuid()
WHERE id = (
  SELECT id FROM jobs
  WHERE status IN ('Pending','Retrying') AND run_at <= now()
  ORDER BY run_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1)
RETURNING *;
```
Note: if EF stores the enum as int, adjust the status comparisons (or use `HasConversion<string>()` — recommended, matches CONTRACT).

## Done when
B and C can inject `IJobRepository` and everything in CONTRACT.md works against a real Postgres.
