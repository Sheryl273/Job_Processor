# Person C — API and tests

**My role:** I own `src/Jobs.Api/Endpoints`, `src/Jobs.Api/Dtos` and `tests/`. Person D codes against my JSON, so shapes must match `docs/CONTRACT.md` exactly.

**Attached/pasted:** `docs/CONTRACT.md`, `IJobRepository.cs`, entity classes, `JobDtos.cs`, `JobEndpoints.cs`, `Program.cs`, `docs/tasks/C-api-tests.md`, existing tests.

**Please produce:**
1. Complete `JobEndpoints.MapJobEndpoints` (minimal API) for every route in the contract, including validation (required `type`, `pageSize` 1–100, invalid status → 400, unknown id → 404) and the `{ "error": "..." }` error shape.
2. Entity → DTO mapping (status as string, camelCase JSON).
3. `POST /api/demo/seed?count=N` producing a random mix of `demo.succeed`, `demo.flaky`, `demo.always-fail`.
4. xUnit tests:
   - backoff calculator (extend the existing tests)
   - retry-exhaustion decision logic (ask me to paste Person B's pure decision method)
   - API tests with `WebApplicationFactory<Program>` and a fake `IJobRepository` for happy paths and validation errors
5. A `curl` cheat sheet for manually testing every endpoint.

**Constraints:** no changes to DTO shapes without telling me so I can inform Person D; keep handlers thin (logic in repository/worker).
