# Person C — API + tests (`src/Jobs.Api/Endpoints`, `Dtos`, `tests/`)

Branch: `feat/c-api` · Start with mock data if A isn't ready; keep DTOs identical to CONTRACT.md.

## Checklist
- [ ] Implement every route in `JobEndpoints.MapJobEndpoints` (see CONTRACT.md)
- [ ] Validation: `type` required, `pageSize` clamped (1–100), unknown status → 400, unknown id → 404
- [ ] Map entities → DTOs (status as string)
- [ ] `POST /api/demo/seed?count=N` with random mix of the 3 demo types
- [ ] Swagger works at `/swagger`
- [ ] Tests: backoff (stub exists) · retry exhaustion → dead-letter (fake repository) · claim concurrency (if time) · API happy path with `WebApplicationFactory` (if time)
- [ ] Tell D immediately if any response shape changes

## Done when
Every endpoint in CONTRACT.md returns the documented JSON and `dotnet test` is green.
