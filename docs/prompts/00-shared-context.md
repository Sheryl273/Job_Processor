# Shared context (paste first)

I'm on a 4-person team building a **Background Job Processor with a Job Status Dashboard** in 4 hours.

**Requirements:** ASP.NET Core backend · background processing via BackgroundService · job queue mechanism · retry failed jobs · exponential backoff · configurable max retry count · dead-letter storage for permanent failures · status API · React or Blazor dashboard showing job state, failures and failure details · persist job and dead-letter info. Tags: ASP.NET Core, BackgroundService/IHostedService, React/Blazor, AWS.

**Architecture:** one ASP.NET Core host (API + BackgroundService), PostgreSQL as the durable queue, atomic claim with `FOR UPDATE SKIP LOCKED` plus a claim token, full-jitter exponential backoff, dashboard polling every 2s, Docker, AWS ECS Fargate + RDS.

**Repo layout:** `src/Jobs.Core` (entities, IJobRepository, IJobHandler, options, BackoffCalculator) · `src/Jobs.Infrastructure` (EF Core + Npgsql) · `src/Jobs.Api` (endpoints, worker, handlers) · `tests/Jobs.Tests` · `dashboard/`.

**Rules for you (the assistant):**
- Follow `docs/CONTRACT.md` exactly (I'll paste it). Do not rename or reshape anything in it.
- Only write code for MY area; don't modify other people's files. If you need a change to the contract, say so instead of doing it.
- Target .NET 8, C# nullable enabled, async/await with CancellationToken everywhere.
- Keep it simple and working over clever. No extra frameworks unless I ask.
- Give complete files (not fragments) with the file path above each one.
- Call out anything you are unsure compiles or that I need to test.
- Time budget is tight: do the minimum requirements first, extras last.
