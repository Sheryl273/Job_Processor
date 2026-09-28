# 90-Second Product Demo Script

**Project**: Resilient Distributed Job Processor & Live Telemetry Dashboard  
**Goal**: Demonstrate resilience to downstream outages, worker process crashes, failure DNA fingerprinting, and dead-letter group replay.

---

## ⏱️ Step 1: Initial State & Baseline (0:00 - 0:15)

1. Open your browser to **`http://localhost:5173`**.
2. Navigate to the **Simulator** tab.
3. Click **Reset Database & Simulation** to ensure a clean slate.
4. Switch to the **Overview** tab.

👉 **Audience Observation**:  
The dashboard presents a clean, live telemetry panel with **0 Queued, 0 Processing, 0 Held, 0 Dead, and 0 Succeeded**.

---

## ⏱️ Step 2: High-Volume Workload & Outage Simulation (0:15 - 0:35)

1. Switch to the **Simulator** tab.
2. In the **Enqueue Jobs** card:
   - Select Job Type: `PAYMENT`
   - Set Count: `100`
   - Click **Enqueue Jobs**.
3. Under **Dependency Outages**, toggle **payment-gateway** to **OFFLINE (Simulate Outage)**.
4. Immediately navigate to the **Incidents** tab.

👉 **Audience Observation**:  
- The `payment-gateway` Circuit Breaker card turns **RED (State: Open)**.
- The **Blast-Radius Map** shows 100 jobs shifted into the **Held** state with zero Dead letters.
- The **Retry attempts saved** counter increases rapidly as circuit holding prevents fruitless retries.

---

## ⏱️ Step 3: Circuit Recovery & Zero Data Loss (0:35 - 0:50)

1. Switch back to the **Simulator** tab.
2. Toggle **payment-gateway** back to **ONLINE**.
3. Return to the **Overview** tab and watch the metrics drain.

👉 **Audience Observation**:  
The **100 Held jobs** automatically release and drain cleanly into **100 Succeeded** jobs. Attempts saved counter stays intact, demonstrating failure isolation and retry economy.

---

## ⏱️ Step 4: Failure DNA & Group Replay (0:50 - 1:10)

1. Navigate to the **Simulator** tab.
2. Enqueue `10` **ALWAYS_FAIL** jobs with `Max Retries = 1`.
3. Wait 10 seconds, then navigate to the **Dead Letter** tab.
4. Notice 10 dead-letter entries.
5. Click **Group by Root Cause (Failure DNA)** toggle.
6. Switch to the **Incidents** tab and inspect the **Failure DNA** section.
7. Click the **Replay dead jobs (10)** button on the Failure DNA card.

👉 **Audience Observation**:  
10 dead-lettered jobs sharing fingerprint `14cecc5b46e5` (`InvalidOperationException: Simulated job failure for ALWAYS_FAIL`) are re-queued in a single action, clearing the dead letter queue without manual row-by-row intervention.

---

## ⏱️ Step 5: Worker Crash Simulation & Lease Reaper (1:10 - 1:30)

1. Switch to the **Simulator** tab.
2. Enqueue `10` **REPORT** jobs.
3. Immediately click **Simulate Worker Crash (Kill Worker)**.
4. Switch to the **Timeline** tab.

👉 **Audience Observation**:  
- A `WorkerCrashed` event appears in the timeline log.
- 10 seconds later, the background `LeaseReaper` emits a `LeaseExpired` event.
- Healthy workers reclaim the expired lease, processing all 10 jobs to **Succeeded** with **0 Dead** jobs and zero data loss.
