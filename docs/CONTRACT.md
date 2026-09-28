# Shared Contract (source of truth)

If you want to change anything here, tell the whole team first. Everyone codes against this file.

## Job lifecycle

```
Pending ──claim──► Processing ──ok──► Succeeded
                       │
                       └─fail─► Retrying (RunAt = now + backoff) ──claim──► Processing ...
                                   │
                                   └─attempts exhausted─► Dead (+ row in dead_letters)
```

- `MaxAttempts = MaxRetryCount + 1` (default 6 attempts). `Attempts` = attempts already made.
- Backoff after attempt *n* fails (1-based): `random(0, min(BaseDelay * 2^(n-1), MaxDelay))` (full jitter).
- All timestamps are UTC, serialized as ISO-8601.
- JSON is camelCase. Status is serialized as a string: `"Pending" | "Processing" | "Succeeded" | "Retrying" | "Dead"`.

## Database tables (snake_case)

| Table | Columns |
|---|---|
| `jobs` | id (uuid pk), type, payload (jsonb), status, attempts, max_attempts, run_at, locked_at, locked_by, claim_token, created_at, completed_at, last_error |
| `job_attempts` | id, job_id (fk), attempt_no, started_at, finished_at, succeeded, error, stack_trace |
| `dead_letters` | id, job_id, type, payload, final_error, attempts, failed_at |

Index: `jobs (status, run_at)`.

## Configuration (`appsettings.json` → `JobProcessing`)

`MaxRetryCount`(5) · `BaseDelayMs`(1000) · `MaxDelayMs`(60000) · `PollIntervalMs`(1000) · `MaxConcurrency`(4) · `StaleAfterSeconds`(300)

## HTTP API

Base path `/api`. Errors: `{ "error": "message" }` with 400/404.

### POST /api/jobs
Request: `{ "type": "demo.flaky", "payload": { "any": "json" }, "maxAttempts": 4 }` (`payload`, `maxAttempts` optional)
Response `201`: `JobDto`

### GET /api/jobs?status=Retrying&page=1&pageSize=20
Response: `{ "items": [JobDto], "total": 42, "page": 1, "pageSize": 20 }`

### GET /api/jobs/{id}
Response: `{ "job": JobDto, "payload": "{...}", "attemptHistory": [AttemptDto] }`

### GET /api/jobs/stats
Response: `{ "pending": 0, "processing": 0, "succeeded": 0, "retrying": 0, "dead": 0 }`

### GET /api/deadletters?page=1&pageSize=20
Response: `{ "items": [DeadLetterDto], "total": 3, "page": 1, "pageSize": 20 }`

### POST /api/deadletters/{id}/requeue
Response `200`: `{ "jobId": "..." }` — resets the job to Pending with Attempts=0.

### POST /api/demo/seed?count=20
Enqueues `count` jobs with a random mix of `demo.succeed`, `demo.flaky`, `demo.always-fail`. Response: `{ "enqueued": 20 }`

### DTO shapes

```jsonc
// JobDto
{ "id": "guid", "type": "string", "status": "Retrying", "attempts": 2, "maxAttempts": 6,
  "runAt": "2026-01-01T10:00:00Z", "createdAt": "…", "completedAt": null, "lastError": "Boom" }

// AttemptDto
{ "attemptNo": 1, "startedAt": "…", "finishedAt": "…", "succeeded": false, "error": "Boom", "stackTrace": "…" }

// DeadLetterDto
{ "id": "guid", "jobId": "guid", "type": "demo.always-fail", "payload": "{}",
  "finalError": "Boom", "attempts": 6, "failedAt": "…" }
```

## Job handlers

`IJobHandler { string Type; Task HandleAsync(string payload, CancellationToken ct) }` — throw = failure.
Demo types: `demo.succeed`, `demo.flaky` (~60% fail), `demo.always-fail`.
