const API_BASE = process.env.API_BASE || 'http://localhost:5080/api';

async function request(path, options = {}) {
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

async function poll(fn, { timeoutMs = 30000, intervalMs = 500, label = 'condition' } = {}) {
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
  throw new Error(`Timeout waiting for ${label} after ${timeoutMs}ms. Last error: ${lastErr?.message || 'none'}`);
}

async function runCheckA() {
  console.log('\n--- Running Check A: ALWAYS_FAIL maxRetries=2 ---');
  await request('/sim/reset', { method: 'POST' });

  await request('/sim/enqueue', {
    method: 'POST',
    body: JSON.stringify({ type: 'ALWAYS_FAIL', count: 5, maxRetries: 2 }),
  });

  // Poll until 5 jobs are Dead
  await poll(
    async () => {
      const stats = await request('/stats');
      return stats.dead === 5;
    },
    { timeoutMs: 30000, intervalMs: 500, label: '5 jobs reaching Dead state' }
  );

  const deadJobs = await request('/jobs?status=Dead');
  if (deadJobs.length !== 5) {
    throw new Error(`Expected 5 dead jobs, got ${deadJobs.length}`);
  }

  for (const job of deadJobs) {
    if (job.attempts !== 3) {
      throw new Error(`Job ${job.id} has attempts=${job.attempts}, expected 3`);
    }
  }

  const groups = await request('/failure-groups');
  if (groups.length !== 1) {
    throw new Error(`Expected exactly 1 failure group, got ${groups.length}`);
  }

  console.log('PASS Check A: All 5 ALWAYS_FAIL jobs reached Dead with Attempts=3 and produced 1 failure group.');
}

async function runCheckB() {
  console.log('\n--- Running Check B: PAYMENT circuit breaker hold during outage ---');
  await request('/sim/reset', { method: 'POST' });

  await request('/sim/enqueue', {
    method: 'POST',
    body: JSON.stringify({ type: 'PAYMENT', count: 40 }),
  });

  await request('/sim/outage', {
    method: 'POST',
    body: JSON.stringify({ dependency: 'payment-gateway', down: true }),
  });

  // Poll until circuit becomes Open within 20s
  await poll(
    async () => {
      const circuits = await request('/circuits');
      const c = circuits.find((x) => x.dependency === 'payment-gateway');
      return c && c.state === 'Open';
    },
    { timeoutMs: 20000, intervalMs: 500, label: 'payment-gateway circuit becoming Open' }
  );

  const deadLetters = await request('/jobs/dead-letter');
  if (deadLetters.length !== 0) {
    throw new Error(`Expected 0 dead letters during outage, got ${deadLetters.length}`);
  }

  const stats = await request('/stats');
  if (stats.held <= 0) {
    throw new Error(`Expected stats.held > 0, got ${stats.held}`);
  }

  console.log(`PASS Check B: Circuit became Open within 20s, dead letter count is 0, held jobs=${stats.held}.`);
}

async function runCheckC() {
  console.log('\n--- Running Check C: Outage recovery for PAYMENT jobs ---');
  // End outage
  await request('/sim/outage', {
    method: 'POST',
    body: JSON.stringify({ dependency: 'payment-gateway', down: false }),
  });

  // Poll until all 40 reach Succeeded within 60s
  await poll(
    async () => {
      const stats = await request('/stats');
      return stats.succeeded === 40 && stats.held === 0 && stats.dead === 0;
    },
    { timeoutMs: 60000, intervalMs: 500, label: 'all 40 jobs reaching Succeeded' }
  );

  const jobs = await request('/jobs?type=PAYMENT');
  const maxAttempts = Math.max(...jobs.map((j) => j.attempts));
  if (maxAttempts > 2) {
    throw new Error(`Expected max attempts <= 2, got ${maxAttempts}`);
  }

  console.log(`PASS Check C: All 40 PAYMENT jobs reached Succeeded within 60s with max attempts=${maxAttempts} <= 2.`);
}

async function runCheckD() {
  console.log('\n--- Running Check D: Worker crash simulation & lease expiration ---');
  await request('/sim/reset', { method: 'POST' });

  await request('/sim/enqueue', {
    method: 'POST',
    body: JSON.stringify({ type: 'REPORT', count: 10 }),
  });

  // Immediately kill worker
  await request('/sim/kill-worker', { method: 'POST' });

  // Poll timeline for a LeaseExpired event
  await poll(
    async () => {
      const timeline = await request('/timeline?take=100');
      return timeline.some((e) => e.type === 'LeaseExpired');
    },
    { timeoutMs: 30000, intervalMs: 500, label: 'LeaseExpired event in timeline' }
  );

  // Poll until all 10 reach Succeeded
  await poll(
    async () => {
      const stats = await request('/stats');
      return stats.succeeded === 10;
    },
    { timeoutMs: 40000, intervalMs: 500, label: 'all 10 REPORT jobs reaching Succeeded' }
  );

  const stats = await request('/stats');
  if (stats.dead > 0) {
    throw new Error(`Expected 0 Dead jobs after worker crash recovery, got ${stats.dead}`);
  }

  console.log('PASS Check D: Worker crash detected, LeaseExpired event created, all 10 REPORT jobs succeeded without job loss.');
}

async function main() {
  console.log('Starting Smoke Tests against live app...');

  try {
    await runCheckA();
    await runCheckB();
    await runCheckC();
    await runCheckD();
    console.log('\n========================================');
    console.log('ALL SMOKE TESTS PASSED SUCCESSFULLY! ✅');
    console.log('========================================\n');
  } catch (err) {
    console.error('\n❌ SMOKE TEST FAILED:', err.message);
    process.exitCode = 1;
  }
}

main();
