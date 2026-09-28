# Demo job handlers (Person B)

Implement `IJobHandler` for each. Suggested types:

| Type | Behaviour |
|---|---|
| `demo.succeed` | waits ~1s, succeeds |
| `demo.flaky` | fails ~60% of the time (shows retries) |
| `demo.always-fail` | always throws (shows dead-letter) |
