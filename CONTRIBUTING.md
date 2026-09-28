# Contributing (4-hour sprint rules)

## Ownership
| Person | Branch | Owns |
|---|---|---|
| A | `feat/a-data` | `src/Jobs.Infrastructure/**` |
| B | `feat/b-worker` | `src/Jobs.Api/Worker/**`, `src/Jobs.Api/Handlers/**` |
| C | `feat/c-api` | `src/Jobs.Api/Endpoints/**`, `src/Jobs.Api/Dtos/**`, `tests/**` |
| D | `feat/d-dashboard` | `dashboard/**`, `Dockerfile`, `docker-compose.yml`, `docs/**`, `README.md` |

- Stay inside your folders. Program.cs and `src/Jobs.Core/**` are **shared**: change only after telling the team in chat.
- `docs/CONTRACT.md` is the source of truth. Changing it = announce first.

## Workflow
1. `git pull origin main` → work on your branch.
2. Commit small and often. Message style: `feat(worker): retry with backoff`.
3. Open a PR into `main` at least every ~30 minutes. Keep PRs under ~300 lines.
4. One teammate reviews (5 minutes max, use `docs/prompts/07-code-review.md` if helpful). CI must be green.
5. Squash-merge. Everyone pulls `main` before starting the next chunk.

## Definition of done (per PR)
- Builds and `dotnet test` passes
- Matches CONTRACT.md
- No secrets committed
- PR template filled in

## Communication
- Blocked for more than 10 minutes → say so in chat immediately.
- Contract change needed → post it, wait for a thumbs-up from every affected owner.
- 1:30 checkpoint and cut-list decisions: see `docs/TIMELINE.md`.
