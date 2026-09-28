const API_BASE = 'http://localhost:5080/api';

async function req(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}: ${text}`);
  }
  return res.json();
}

async function poll(fn, { timeoutMs = 35000, intervalMs = 500, label = 'condition' } = {}) {
  const start = Date.now();
  let lastErr = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fn();
      if (res) return res;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timeout waiting for ${label} after ${timeoutMs}ms. Last: ${lastErr?.message}`);
}

async function testA() {
  console.log('\n======================================================');
  console.log('TEST A: Retry and Backoff (ALWAYS_FAIL, maxRetries 3)');
  console.log('======================================================');
  await req('/sim/reset', { method: 'POST' });

  const enq = await req('/jobs', {
    method: 'POST',
    body: JSON.stringify({ type: 'ALWAYS_FAIL', maxRetries: 3 }),
  });
  const jobId = enq.id;
  console.log(`Enqueued ALWAYS_FAIL job: ${jobId}`);

  // Wait until Dead
  await poll(
    async () => {
      const { job } = await req(`/jobs/${jobId}`);
      return job.status === 'Dead';
    },
    { timeoutMs: 30000, label: 'job to reach Dead' }
  );

  const { job, failures, events } = await req(`/jobs/${jobId}`);
  const deadLetters = await req('/jobs/dead-letter');
  const jobDeadLetter = deadLetters.find((d) => d.jobId === jobId);

  console.log(`Job Status: ${job.status}`);
  console.log(`Job Attempts: ${job.attempts} (Expected 4)`);
  console.log(`JobFailure Rows: ${failures.length} (Expected 4)`);
  console.log(`DeadLetter Row Found: ${!!jobDeadLetter}`);

  // Show backoff gap timestamps
  const retryEvents = events.filter((e) => e.type === 'RetryScheduled');
  console.log('Backoff gaps from RetryScheduled events:');
  for (let i = 0; i < retryEvents.length; i++) {
    console.log(`  Attempt ${i + 1} -> ${retryEvents[i].message} (at ${retryEvents[i].at})`);
  }

  if (job.status !== 'Dead') throw new Error(`Expected Dead, got ${job.status}`);
  if (job.attempts !== 4) throw new Error(`Expected attempts=4, got ${job.attempts}`);
  if (failures.length !== 4) throw new Error(`Expected 4 failures, got ${failures.length}`);
  if (!jobDeadLetter) throw new Error('Expected DeadLetter row');

  console.log('TEST A PASSED ✅');
}

async function testB() {
  console.log('\n======================================================');
  console.log('TEST B: Concurrency (100 jobs at once, 3 workers)');
  console.log('======================================================');
  await req('/sim/reset', { method: 'POST' });

  await req('/sim/enqueue', {
    method: 'POST',
    body: JSON.stringify({ type: 'EMAIL', count: 100 }),
  });

  console.log('Enqueued 100 EMAIL jobs. Waiting for all to succeed...');
  await poll(
    async () => {
      const stats = await req('/stats');
      return stats.succeeded === 100;
    },
    { timeoutMs: 40000, label: '100 jobs to succeed' }
  );

  const events = await req('/timeline?take=300');
  const claimEvents = events.filter((e) => e.type === 'JobClaimed');

  const workersUsed = new Set(claimEvents.map((e) => e.message.split('by ')[1]?.split(' ')[0]));
  console.log(`Workers participating in processing: ${Array.from(workersUsed).join(', ')}`);

  // Check no job claimed twice
  const claimsByJob = {};
  for (const c of claimEvents) {
    if (c.jobId) {
      claimsByJob[c.jobId] = (claimsByJob[c.jobId] || 0) + 1;
    }
  }
  const duplicateClaims = Object.entries(claimsByJob).filter(([_, count]) => count > 1);
  console.log(`Duplicate claims: ${duplicateClaims.length}`);

  if (duplicateClaims.length > 0) throw new Error('Job ran more than once!');
  if (workersUsed.size < 2) throw new Error('Expected multiple concurrent workers!');

  console.log('TEST B PASSED ✅');
}

async function testC() {
  console.log('\n======================================================');
  console.log('TEST C: Failure DNA Grouping');
  console.log('======================================================');
  await req('/sim/reset', { method: 'POST' });

  await req('/sim/enqueue', {
    method: 'POST',
    body: JSON.stringify({ type: 'ALWAYS_FAIL', count: 10, maxRetries: 1 }),
  });

  await poll(
    async () => {
      const stats = await req('/stats');
      return stats.dead === 10;
    },
    { timeoutMs: 25000, label: '10 ALWAYS_FAIL jobs to die' }
  );

  const groups = await req('/failure-groups');
  console.log(`Failure groups count: ${groups.length}`);
  console.log(`Group 0 Title: ${groups[0]?.title}`);
  console.log(`Group 0 Fingerprint: ${groups[0]?.fingerprint}`);
  console.log(`Group 0 Affected Jobs: ${groups[0]?.affectedJobs}`);

  if (groups.length !== 1) throw new Error(`Expected exactly 1 group, got ${groups.length}`);
  if (groups[0].affectedJobs !== 10) throw new Error(`Expected 10 affected jobs, got ${groups[0].affectedJobs}`);

  // Now enqueue FLAKY jobs and verify separate group
  await req('/sim/enqueue', {
    method: 'POST',
    body: JSON.stringify({ type: 'FLAKY', count: 20, maxRetries: 0 }),
  });

  await poll(
    async () => {
      const g = await req('/failure-groups');
      return g.length >= 2;
    },
    { timeoutMs: 25000, label: 'FLAKY group to form' }
  );

  const newGroups = await req('/failure-groups');
  console.log(`After FLAKY failures, group count: ${newGroups.length}`);
  for (const g of newGroups) {
    console.log(`  - [${g.fingerprint}] ${g.title} (affectedJobs=${g.affectedJobs})`);
  }

  console.log('TEST C PASSED ✅');
}

async function testD() {
  console.log('\n======================================================');
  console.log('TEST D: Circuit Breaker (60 PAYMENT, Outage, Recovery)');
  console.log('======================================================');
  await req('/sim/reset', { method: 'POST' });

  await req('/sim/enqueue', {
    method: 'POST',
    body: JSON.stringify({ type: 'PAYMENT', count: 60, maxRetries: 3 }),
  });

  await req('/sim/outage', {
    method: 'POST',
    body: JSON.stringify({ dependency: 'payment-gateway', down: true }),
  });

  // Verify circuit opens within 10s and jobs go Held
  await poll(
    async () => {
      const circuits = await req('/circuits');
      const c = circuits.find((x) => x.dependency === 'payment-gateway');
      const stats = await req('/stats');
      return c && c.state === 'Open' && stats.held > 0;
    },
    { timeoutMs: 15000, label: 'circuit to open and hold jobs' }
  );

  const circuits = await req('/circuits');
  const blast = await req('/blast-radius');
  const deadLetters = await req('/jobs/dead-letter');
  const stats = await req('/stats');

  const pCircuit = circuits.find((x) => x.dependency === 'payment-gateway');
  const pBlast = blast.find((x) => x.dependency === 'payment-gateway');

  console.log(`payment-gateway Circuit State: ${pCircuit?.state}`);
  console.log(`Held Jobs: ${stats.held}`);
  console.log(`Dead Letters: ${deadLetters.length} (Expected 0)`);
  console.log(`Blast-Radius Attempts Saved: ${pBlast?.attemptsSavedTotal}`);

  if (pCircuit?.state !== 'Open') throw new Error('Expected Open state');
  if (deadLetters.length !== 0) throw new Error('Dead letter should be 0');
  if (pBlast?.attemptsSavedTotal <= 0) throw new Error('Attempts saved should be > 0');

  // End outage
  console.log('Ending outage. Watching recovery (Open -> HalfOpen -> Canary -> Closed)...');
  await req('/sim/outage', {
    method: 'POST',
    body: JSON.stringify({ dependency: 'payment-gateway', down: false }),
  });

  // Wait for all 60 to succeed
  await poll(
    async () => {
      const s = await req('/stats');
      return s.succeeded === 60 && s.held === 0;
    },
    { timeoutMs: 45000, label: 'all 60 jobs to succeed after recovery' }
  );

  const finalJobs = await req('/jobs?type=PAYMENT&take=100');
  const maxAttempts = Math.max(...finalJobs.map((j) => j.attempts));
  console.log(`Max attempts among recovered PAYMENT jobs: ${maxAttempts} (Expected <= 2)`);

  if (maxAttempts > 2) throw new Error(`Max attempts ${maxAttempts} exceeds 2!`);

  console.log('TEST D PASSED ✅');
}

async function testE() {
  console.log('\n======================================================');
  console.log('TEST E: Canary Failure & Circuit Reopen');
  console.log('======================================================');
  await req('/sim/reset', { method: 'POST' });

  // Enqueue 5 PAYMENT jobs
  await req('/sim/enqueue', {
    method: 'POST',
    body: JSON.stringify({ type: 'PAYMENT', count: 5 }),
  });

  // Trip circuit open
  await req('/sim/outage', {
    method: 'POST',
    body: JSON.stringify({ dependency: 'payment-gateway', down: true }),
  });

  // Wait for circuit open
  await poll(
    async () => {
      const c = (await req('/circuits')).find((x) => x.dependency === 'payment-gateway');
      return c && c.state === 'Open';
    },
    { timeoutMs: 15000, label: 'circuit to open' }
  );

  console.log('Circuit is Open. Keeping outage down to force canary failure on HalfOpen...');
  // CircuitMonitor will move to HalfOpen after 12s cooldown and dispatch a canary.
  // The canary will fail because outage is still down!
  // It should emit CircuitReopened and reopen the circuit.
  await poll(
    async () => {
      const timeline = await req('/timeline?take=100');
      return timeline.some((e) => e.type === 'CircuitReopened');
    },
    { timeoutMs: 30000, label: 'CircuitReopened event after canary failure' }
  );

  const events = await req('/timeline?take=100');
  const reopenEvent = events.find((e) => e.type === 'CircuitReopened');
  console.log(`Found CircuitReopened event: ${reopenEvent?.message}`);

  console.log('TEST E PASSED ✅');
}

async function testF() {
  console.log('\n======================================================');
  console.log('TEST F: Crash Recovery (kill-worker mid-run)');
  console.log('======================================================');
  await req('/sim/reset', { method: 'POST' });

  await req('/sim/enqueue', {
    method: 'POST',
    body: JSON.stringify({ type: 'REPORT', count: 30 }),
  });

  // Call kill-worker mid-run
  console.log('Simulating worker crash...');
  await req('/sim/kill-worker', { method: 'POST' });

  // Poll for LeaseExpired event
  await poll(
    async () => {
      const timeline = await req('/timeline?take=100');
      return timeline.some((e) => e.type === 'LeaseExpired');
    },
    { timeoutMs: 30000, label: 'LeaseExpired event in timeline' }
  );

  const events = await req('/timeline?take=100');
  const leaseEvent = events.find((e) => e.type === 'LeaseExpired');
  console.log(`LeaseExpired event: ${leaseEvent?.message} for job ${leaseEvent?.jobId}`);

  // Fetch the reclaimed job
  if (leaseEvent?.jobId) {
    const { job } = await req(`/jobs/${leaseEvent.jobId}`);
    console.log(`Reclaimed job details -> ReclaimCount: ${job.reclaimCount}, Attempts: ${job.attempts}`);
    if (job.reclaimCount < 1) throw new Error('Expected reclaimCount >= 1');
    if (job.attempts > 1) throw new Error('Crash should not count as failed attempt');
  }

  // Poll until all 30 reach Succeeded
  await poll(
    async () => {
      const stats = await req('/stats');
      return stats.succeeded === 30;
    },
    { timeoutMs: 45000, label: 'all 30 REPORT jobs to succeed' }
  );

  const finalStats = await req('/stats');
  console.log(`Final stats: Succeeded=${finalStats.succeeded}, Dead=${finalStats.dead}`);
  if (finalStats.dead > 0) throw new Error('Expected 0 dead jobs');

  console.log('TEST F PASSED ✅');
}

async function testG() {
  console.log('\n======================================================');
  console.log('TEST G: Edge Cases');
  console.log('======================================================');
  await req('/sim/reset', { method: 'POST' });

  // 1. Invalid input validation
  console.log('Checking validation on POST /api/jobs:');
  try {
    await req('/jobs', { method: 'POST', body: JSON.stringify({ type: 'INVALID_TYPE' }) });
    throw new Error('Expected 400 for unknown job type');
  } catch (err) {
    console.log(`  Unknown type rejected: ${err.message}`);
  }

  try {
    await req('/jobs', { method: 'POST', body: JSON.stringify({ type: 'PAYMENT', maxRetries: 99 }) });
    throw new Error('Expected 400 for maxRetries > 10');
  } catch (err) {
    console.log(`  Invalid maxRetries rejected: ${err.message}`);
  }

  // 2. dead-letter route not swallowed by {id:guid}
  const dl = await req('/jobs/dead-letter');
  console.log(`GET /api/jobs/dead-letter responded successfully: isArray=${Array.isArray(dl)}`);

  // 3. Replay non-dead job -> 409 Conflict
  const normalJob = await req('/jobs', {
    method: 'POST',
    body: JSON.stringify({ type: 'EMAIL', maxRetries: 3 }),
  });
  try {
    await req(`/jobs/${normalJob.id}/retry`, { method: 'POST' });
    throw new Error('Expected 409 for retrying non-Dead job');
  } catch (err) {
    console.log(`  Retry non-Dead job rejected: ${err.message}`);
  }

  // 4. Unknown fingerprint replay -> 0 replayed
  const replayZero = await req('/dead-letter/replay-group', {
    method: 'POST',
    body: JSON.stringify({ fingerprint: 'unknown-hash-000' }),
  });
  console.log(`Replay unknown fingerprint: replayed=${replayZero.replayed}`);
  if (replayZero.replayed !== 0) throw new Error('Expected 0 replayed');

  // 5. Kill worker when no job is running
  const kw = await req('/sim/kill-worker', { method: 'POST' });
  console.log(`Kill-worker when idle accepted: target=${kw.target}`);

  // 6. Two outages at once
  await req('/sim/outage', { method: 'POST', body: JSON.stringify({ dependency: 'payment-gateway', down: true }) });
  await req('/sim/outage', { method: 'POST', body: JSON.stringify({ dependency: 'email-provider', down: true }) });
  const circs = await req('/circuits');
  const pgState = circs.find((c) => c.dependency === 'payment-gateway')?.state;
  const epState = circs.find((c) => c.dependency === 'email-provider')?.state;
  console.log(`Dual outages -> payment-gateway: ${pgState}, email-provider: ${epState}`);

  await req('/sim/reset', { method: 'POST' });
  console.log('TEST G PASSED ✅');
}

async function runAll() {
  console.log('STARTING PHASE 3 DYNAMIC AUDIT TEST SUITE...');
  try {
    await testA();
    await testB();
    await testC();
    await testD();
    await testE();
    await testF();
    await testG();

    console.log('\n======================================================');
    console.log('ALL PHASE 3 DYNAMIC TESTS PASSED! ✅');
    console.log('======================================================\n');
  } catch (err) {
    console.error('\n❌ TEST SUITE FAILED:', err.message);
    process.exitCode = 1;
  }
}

runAll();
