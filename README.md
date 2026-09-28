# Reliable Distributed Job Processor & Live Telemetry Dashboard

A production-grade, resilient distributed job processing engine and live telemetry web application built with C# ASP.NET Core 8 and React TypeScript (Vite + Tailwind CSS). It provides fault tolerance through lease-based worker crash recovery, circuit-breaker bulk-holding to prevent cascading failures, failure DNA fingerprinting with group dead-letter replays, real-time Blast-Radius visual tracing, and priority-aware atomic queue processing.

---

## 5 Key Differentiators

1. **Lease-Based Worker Crash Recovery**: Unlike basic queues that lock jobs indefinitely when a worker process crashes, this system attaches a 10-second heartbeat lease (`LeaseExpiresAt`) to processing jobs. A background `LeaseReaper` service polls every 2 seconds to reclaim expired leases from dead workers, emitting `LeaseExpired` timeline events and re-queueing jobs for pickup by healthy workers with zero data or job loss.

2. **Circuit Breaker & Bulk-Hold Failure Isolation**: When downstream dependencies fail (such as payment gateways or email providers), continuing to dispatch failing retries wastes system resources and risks secondary outages. The system monitors failure rates and opens dependency-level circuit breakers, automatically promoting matching queued and retrying jobs into a `Held` state to preserve retry budgets and track `AttemptsSaved`.

3. **Failure DNA Fingerprinting & Group Replay**: Error messages often vary by transaction IDs or timestamps, leading to fragmented error logs. The `Fingerprinter` engine normalizes GUIDs, hex tokens, double-quoted strings, and numeric sequences into canonical SHA-256 hashes, grouping identical root causes into actionable Failure DNA cards with single-click bulk replay capabilities for dead-lettered jobs.

4. **Live Blast-Radius Tracing**: The dashboard features an interactive flexbox Blast-Radius visualization that dynamically connects dependency health nodes to active job types and status counters. Operational teams gain immediate visibility into downstream outages, total affected jobs, circuit states, and cumulative retries saved by automated circuit holds.

5. **Priority-Aware Atomic Claiming**: Job dispatching utilizes multi-threaded worker pools controlled by a `SemaphoreSlim` throttling pipeline. Workers claim jobs in atomic database transactions prioritized by queue urgency (`Urgent` > `High` > `Normal` > `Low`) and `NextRunAt` timestamps, avoiding thundering herd contention across concurrent worker threads.

---

## System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                            React Dashboard                             │
│      Overview  │  Jobs  │  Incidents  │  Dead-Letter  │  Simulator    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ REST API (JSON)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                          ASP.NET Core 8 API                            │
│  ┌───────────────────────────┐      ┌───────────────────────────────┐  │
│  │   Job & Sim Endpoints     │      │     CircuitBreakerManager     │  │
│  └─────────────┬─────────────┘      └───────────────┬───────────────┘  │
│                │                                    │                  │
│  ┌─────────────▼─────────────┐      ┌───────────────▼───────────────┐  │
│  │   WorkerPool (N Workers)  │      │     LeaseReaper (2s Poll)     │  │
│  │ ┌───────────────────────┐ │      │  (Reclaims expired leases)    │  │
│  │ │ JobClaimer + Handlers │ │      └───────────────┬───────────────┘  │
│  │ └───────────┬───────────┘ │                      │                  │
│  └─────────────┼─────────────┘                      │                  │
└────────────────┼────────────────────────────────────┼──────────────────┘
                 │ DbContextFactory (SQLite)          │
                 ▼                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       SQLite Database (jobs.db)                        │
│  [Jobs]   [JobFailures]   [DeadLetters]   [EventLogs]   [Incidents]    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## How to Run

### Prerequisites
- .NET 8.0 SDK
- Node.js v20+

### Start the Backend API
```bash
dotnet run --project api
```
*API runs at `http://localhost:5080`*

### Start the Frontend Web App
```bash
cd web
npm install
npm run dev
```
*Dashboard runs at `http://localhost:5173`*

### Run Automated Smoke Test Suite
```bash
node scripts/smoke.mjs
```

---

## API Endpoints

### Core Job Management
- `POST /api/jobs` — Enqueue a single job
- `GET /api/jobs` — List jobs (filtered by status, type, take)
- `GET /api/jobs/{id}` — Get job details, failure history, and event timeline
- `POST /api/jobs/{id}/retry` — Manually retry a Dead job

### Dead-Letter & Recovery
- `GET /api/jobs/dead-letter` — List unreplayed dead-lettered jobs
- `POST /api/dead-letter/{id}/replay` — Replay specific dead letter
- `POST /api/dead-letter/replay-group` — Bulk replay dead letters by fingerprint

### Telemetry & Monitoring
- `GET /api/stats` — Overall status counts & attempts saved
- `GET /api/timeline` — Live audit log event stream
- `GET /api/failure-groups` — Failure DNA root cause analysis
- `GET /api/blast-radius` — Dependency blast radius status
- `GET /api/circuits` — Circuit breaker states & metrics

### Simulator & Testing
- `POST /api/sim/enqueue` — Bulk enqueue test workload
- `POST /api/sim/outage` — Trigger dependency outage simulation
- `GET /api/sim/state` — Simulator outage & worker registry status
- `POST /api/sim/kill-worker` — Simulate worker process crash
- `POST /api/sim/reset` — Reset database and runtime state

---

## Configuration Keys (`appsettings.json`)

```json
{
  "Processing": {
    "WorkerCount": 4,
    "LeaseDurationSeconds": 10,
    "LeaseReaperIntervalSeconds": 2,
    "BaseDelaySeconds": 1,
    "MaxDelaySeconds": 30,
    "JitterPercent": 20
  }
}
```

---

## Known Limitations

1. **Single-Node Execution**: In-memory worker registries and fault state are scoped to a single process. Multi-node clusters require distributed locks (e.g. Redis / Etcd).
2. **SQLite Storage**: Uses SQLite with `WAL` mode for simplicity and zero setup overhead. High-throughput distributed environments should use PostgreSQL with `FOR UPDATE SKIP LOCKED`.
3. **Transient Fault State**: Fault simulation state resets if the backend process restarts.
