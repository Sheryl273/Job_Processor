# Person D — Docker and AWS

**My role:** get the app running with one command locally and deployed on AWS.

**Attached/pasted:** `Dockerfile`, `docker-compose.yml`, `src/Jobs.Api/appsettings.json`, `docs/ARCHITECTURE.md`.

**Please help with:**
1. Review/improve the Dockerfile and docker-compose (health checks, migrations at startup, env var overrides like `ConnectionStrings__Jobs` and `JobProcessing__MaxRetryCount`).
2. A step-by-step AWS deployment using the **AWS CLI** (or console steps): ECR repo → push image → RDS PostgreSQL (private) → Secrets Manager for the connection string → ECS Fargate cluster/task definition/service (2 tasks to show SKIP LOCKED works with multiple workers) → ALB with `/health` check → CloudWatch logs. Include security-group rules between ALB, ECS and RDS.
3. Estimated cost and how to tear everything down afterwards.
4. A fallback plan if AWS takes too long (what to document/demo instead).

**Constraints:** smallest working setup, not production perfection; tell me which steps are slow (RDS creation) so I can start them early; never put secrets in the repo.
