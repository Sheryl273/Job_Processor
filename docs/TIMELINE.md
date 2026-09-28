# 4-hour timeline

| Time | Goal | Everyone |
|---|---|---|
| 0:00–0:20 | Kickoff: run `scripts/setup.sh`, read CONTRACT.md, create branches | together |
| 0:20–1:30 | Parallel build (see docs/tasks/) | A, B, C, D |
| **1:30** | **HARD CHECKPOINT: one job flows enqueue → worker → dashboard** | together |
| 1:30–2:15 | Integrate + fix; merge everything to `main` | together |
| 2:15–3:15 | Verify retry / backoff / dead-letter live; tests; polish | B, C, A, D |
| 3:15–3:45 | Docker + AWS deploy (fallback: docker-compose) | D + A |
| 3:45–4:00 | README, demo script rehearsal, final push | together |

## Cut list (in order) if behind
SignalR → requeue button → charts → paging → stale recovery → AWS deploy (keep Docker/compose).

## Never cut
DB persistence · retry · exponential backoff · configurable max retries · dead-letter storage · status API · dashboard showing state + failure details.
