# Background Job Processor with Job Status Dashboard

A reliable background job processor for ASP.NET Core: retries, exponential backoff with jitter, dead-letter storage, a status API, and a live dashboard. Jobs and dead letters persist in PostgreSQL.

> Status: scaffold. Replace this section with real status/screenshots before the demo.

## Requirements coverage

| Requirement | Where |
|---|---|
| ASP.NET Core backend | `src/Jobs.Api` |
| BackgroundService processing | `src/Jobs.Api/Worker/JobProcessorService.cs` |
| Job queue mechanism | Postgres table + `SKIP LOCKED` claim (`src/Jobs.Infrastructure`) |
| Retry, exponential backoff, configurable max retries | `BackoffCalculator`, `JobProcessing` config |
| Dead-letter storage | `dead_letters` table |
| Status API | `src/Jobs.Api/Endpoints` |
| React/Blazor dashboard | `dashboard/` |
| Persistence | PostgreSQL |

## Quick start
```bash
./scripts/setup.sh                 # creates Jobs.sln (needs .NET SDK)
docker compose up -d db
dotnet run --project src/Jobs.Api  # http://localhost:5000/swagger (port printed on start)
dotnet test
# full stack in containers:
docker compose up --build          # http://localhost:8080
```

## Team workflow
Read **CONTRIBUTING.md**, then your task card in `docs/tasks/`. AI prompts live in `docs/prompts/`.

## Docs
- `docs/CONTRACT.md` — API, DTOs, DB schema, retry semantics (source of truth)
- `docs/ARCHITECTURE.md` · `docs/TIMELINE.md` · `docs/DEMO_SCRIPT.md`

## File structure
```
job-processor/
├── .github/
│   ├── CODEOWNERS
│   ├── PULL_REQUEST_TEMPLATE.md
│   ├── ISSUE_TEMPLATE/task.md
│   └── workflows/ci.yml
├── docs/
│   ├── CONTRACT.md  ARCHITECTURE.md  TIMELINE.md  DEMO_SCRIPT.md
│   ├── tasks/       A-data.md  B-worker.md  C-api-tests.md  D-dashboard-ship.md
│   └── prompts/     00-shared-context … 08-readme-and-demo
├── src/
│   ├── Jobs.Core/            (shared: entities, IJobRepository, IJobHandler, options, BackoffCalculator)
│   ├── Jobs.Infrastructure/  (A: EF Core, migrations, PostgresJobRepository)
│   └── Jobs.Api/             (B: Worker, Handlers · C: Endpoints, Dtos · Program.cs)
├── tests/Jobs.Tests/         (C)
├── dashboard/                (D)
├── scripts/                  setup.sh  create-github-repo.sh
├── Dockerfile  docker-compose.yml  Directory.Build.props
└── CONTRIBUTING.md  README.md
```
