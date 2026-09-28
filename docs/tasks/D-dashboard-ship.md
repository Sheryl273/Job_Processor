# Person D — Dashboard + shipping (`dashboard/`, `Dockerfile`, docs)

Branch: `feat/d-dashboard` · Start with hard-coded mock JSON copied from CONTRACT.md.

## Checklist — Dashboard (choose one; see dashboard/README.md)
- [ ] Stat cards from `/api/jobs/stats` (poll every 2s)
- [ ] Jobs table with status filter + paging, status badges (colours per status)
- [ ] Job detail: payload, attempt history, error + stack trace, next run time
- [ ] Dead-letter page with final error (and requeue button if time)
- [ ] "Seed demo jobs" button → `POST /api/demo/seed`
- [ ] Loading / error / empty states
- [ ] Served by the API (build output → `src/Jobs.Api/wwwroot`) OR hosted separately

## Checklist — Shipping
- [ ] `docker compose up --build` runs the whole stack
- [ ] AWS: ECR → ECS Fargate (+ ALB) → RDS Postgres; connection string via Secrets Manager / env var `ConnectionStrings__Jobs`
- [ ] README: overview, architecture diagram, run instructions, screenshots
- [ ] Rehearse `docs/DEMO_SCRIPT.md`

## Done when
A stranger can clone, run one command, and watch jobs succeed, retry and die on the dashboard.
