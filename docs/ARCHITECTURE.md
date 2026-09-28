# Architecture

One deployable ASP.NET Core app (API + BackgroundService worker) backed by PostgreSQL.

```
Dashboard ──HTTP (poll 2s)──► Minimal API ──► IJobRepository ──► PostgreSQL
                                                   ▲
                       JobProcessorService ────────┘  (claim → run handler → retry / dead-letter)
```

## Why these choices
- **Postgres is the queue**: persistence for free; `FOR UPDATE SKIP LOCKED` gives safe concurrent claiming, so several containers can run without double-processing.
- **Claim token**: finalizing a job requires the token it was claimed with, so a slow worker cannot overwrite a job that was recovered and re-claimed.
- **Full-jitter exponential backoff** avoids synchronized retry storms.
- **Single host** keeps a 4-hour build simple. The worker is a separate class and can be split out later.
- **Polling dashboard** first; SignalR is a stretch goal.

## Ownership map
| Area | Path | Owner |
|---|---|---|
| Data & repository | `src/Jobs.Infrastructure` | A |
| Worker & handlers | `src/Jobs.Api/Worker`, `src/Jobs.Api/Handlers` | B |
| API & tests | `src/Jobs.Api/Endpoints`, `src/Jobs.Api/Dtos`, `tests/` | C |
| Dashboard, Docker, AWS, README | `dashboard/`, `Dockerfile`, `docs/` | D |
| Shared contract | `src/Jobs.Core`, `docs/CONTRACT.md` | everyone (change only by agreement) |
