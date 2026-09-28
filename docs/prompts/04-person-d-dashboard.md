# Person D — Dashboard

**My role:** I own `dashboard/` (chosen framework: **[React + Vite + TypeScript] / [Blazor]** — delete one).

**Attached/pasted:** `docs/CONTRACT.md` (API + DTO shapes), `docs/tasks/D-dashboard-ship.md`, `docs/DEMO_SCRIPT.md`.

**Please produce a complete, minimal, good-looking dashboard:**
1. Typed API client for every endpoint in the contract (base URL configurable; dev proxy to `http://localhost:8080`).
2. Stat cards for Pending / Processing / Succeeded / Retrying / Dead, polling `/api/jobs/stats` every 2s.
3. Jobs table with status filter, paging, colour-coded status badges, attempts (n/max), next run time for Retrying jobs.
4. Job detail view: payload, attempt history timeline, error message and stack trace.
5. Dead-letter page: type, final error, attempts, failed time, optional requeue button.
6. "Seed demo jobs" button.
7. Loading, error and empty states; stops polling when the tab is hidden.
8. Instructions to build and copy the output into `src/Jobs.Api/wwwroot`.

**Constraints:** no UI framework beyond what ships with the template unless it saves time (plain CSS is fine); do not invent API fields that aren't in the contract; start with mock data so I'm not blocked on Person C.
