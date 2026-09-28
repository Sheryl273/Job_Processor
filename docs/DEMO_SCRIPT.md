# Demo script (3 minutes)

1. Open the dashboard: all counters at zero.
2. `POST /api/demo/seed?count=20` (button or Swagger).
3. Watch jobs move Pending → Processing → Succeeded. Point out `demo.flaky` jobs entering **Retrying** with growing delays.
4. Open a retrying job: show attempt history and error details.
5. Wait for `demo.always-fail` jobs to reach **Dead**; open the dead-letter page and show the final error.
6. (Optional) Requeue a dead letter.
7. Restart the app: show all data persisted.
8. Show `appsettings.json`: change `MaxRetryCount`, restart, re-run.
