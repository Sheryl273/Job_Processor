# AI prompt library

Copy-paste prompts for Claude (or any assistant). How to use:

1. Paste **00-shared-context.md** first in a new chat (it holds the project rules).
2. Then paste your role prompt (01–05).
3. Attach or paste the files it asks for (`docs/CONTRACT.md`, `IJobRepository.cs`, etc.).
4. Review generated code yourself before committing. You own what you push.

| File | Who | Purpose |
|---|---|---|
| 00-shared-context | all | project background + rules |
| 01-person-a-data | A | EF Core mapping, migrations, repository, SKIP LOCKED claim |
| 02-person-b-worker | B | BackgroundService, retries, backoff, dead-letter, demo handlers |
| 03-person-c-api-tests | C | endpoints, DTOs, validation, xUnit tests |
| 04-person-d-dashboard | D | React or Blazor dashboard |
| 05-person-d-devops-aws | D | Dockerfile, compose, AWS ECS/RDS deploy |
| 06-integration-debugging | all | debug end-to-end problems |
| 07-code-review | all | review a PR before merge |
| 08-readme-and-demo | D | README, architecture diagram, demo polish |
