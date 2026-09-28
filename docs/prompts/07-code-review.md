# Code review

Review this pull request for our background job processor. Be strict but brief.

**PR description:** [paste]
**Diff or files:** [paste]

Check specifically for:
- Contract violations (`docs/CONTRACT.md`): DTO shapes, status strings, retry semantics (`MaxAttempts = MaxRetryCount + 1`)
- Concurrency bugs: non-atomic claim, missing claim-token check, shared DbContext across threads
- Backoff correctness (full jitter, capped) and retry-exhaustion off-by-one
- Swallowed exceptions, missing CancellationToken, blocking calls (`.Result`, `.Wait()`)
- SQL injection or string-built SQL
- Secrets or connection strings committed
- Missing tests for new logic

Output: (1) blocking issues, (2) non-blocking suggestions, (3) one-line verdict: approve / request changes.
