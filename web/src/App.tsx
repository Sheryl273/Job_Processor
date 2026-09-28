import React, { useState, useEffect } from 'react';
import { api, type Job, type DeadLetter } from './api';
import { usePolling } from './usePolling';
import './styles.css';

function formatRelativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return 'N/A';
  const diffMs = Date.now() - new Date(dateStr).getTime();
  if (diffMs < 0) return 'just now';
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Job Details Drawer ────────────────────────────────────────────────────────
function JobDrawer({ job, onClose }: { job: Job; onClose: () => void }) {
  const { data: failures } = usePolling(() => api.getJobFailures(job.id));
  const { data: events } = usePolling(() => api.getJobEvents(job.id));

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={e => e.stopPropagation()}>
        <h2>
          Job Details
          <button className="close-btn" onClick={onClose}>&times;</button>
        </h2>
        <div className="job-details-grid">
          <div className="job-detail-item"><strong>ID</strong> {job.id}</div>
          <div className="job-detail-item"><strong>Name</strong> {job.name}</div>
          <div className="job-detail-item"><strong>Type</strong> {job.type}</div>
          <div className="job-detail-item">
            <strong>Status</strong> <span className={`badge ${job.status.toLowerCase()}`}>{job.status}</span>
          </div>
          <div className="job-detail-item"><strong>Priority</strong> {job.priority}</div>
          <div className="job-detail-item"><strong>Dependency</strong> {job.dependency}</div>
          <div className="job-detail-item"><strong>Attempts</strong> {job.attempts} / {job.maxRetries}</div>
          <div className="job-detail-item"><strong>Next Run At</strong> {job.nextRunAt ? new Date(job.nextRunAt).toLocaleString() : 'N/A'}</div>
          <div className="job-detail-item"><strong>Created At</strong> {new Date(job.createdAt).toLocaleString()}</div>
          <div className="job-detail-item"><strong>Reclaim Count</strong> {job.reclaimCount}</div>
        </div>

        <h3>Failure History</h3>
        {failures?.length === 0 ? <p className="muted-text">No failures recorded.</p> : (
          failures?.map(f => (
            <div key={f.id} className="history-item">
              <div><strong>Attempt {f.attempt}</strong> ({new Date(f.at).toLocaleString()})</div>
              <div><strong>Type:</strong> {f.exceptionType}</div>
              <div><strong>Message:</strong> {f.message}</div>
              <div><strong>Fingerprint:</strong> <code>{f.fingerprint}</code></div>
              {f.stackTrace && (
                <details>
                  <summary>Stack Trace</summary>
                  <pre>{f.stackTrace}</pre>
                </details>
              )}
            </div>
          ))
        )}

        <h3 className="timeline">Event Timeline</h3>
        {events?.length === 0 ? <p className="muted-text">No events logged.</p> : (
          events?.map(e => (
            <div key={e.id} className="timeline-item">
              <div className="timeline-time">{new Date(e.at).toLocaleString()} - <strong>{e.type}</strong></div>
              <div>{e.message}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Overview Tab ─────────────────────────────────────────────────────────────
function OverviewTab() {
  const { data: stats } = usePolling(api.getStats);
  const { data: simState } = usePolling(api.simState);

  return (
    <div>
      <div className="grid">
        <div className="stat-tile">
          <div className="stat-title">Total</div>
          <div className="stat-value">{stats?.total || 0}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-title">Queued</div>
          <div className="stat-value">{stats?.queued || 0}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-title">Processing</div>
          <div className="stat-value">{stats?.processing || 0}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-title">Retrying</div>
          <div className="stat-value">{stats?.retrying || 0}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-title">Held</div>
          <div className="stat-value">{stats?.held || 0}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-title">Succeeded</div>
          <div className="stat-value">{stats?.succeeded || 0}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-title">Dead Letter</div>
          <div className="stat-value">{stats?.dead || 0}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-title">Failed Attempts</div>
          <div className="stat-value">{stats?.failedAttempts || 0}</div>
        </div>
        <div className="stat-tile highlight-tile">
          <div className="stat-title">Retries Saved</div>
          <div className="stat-value" style={{ color: 'var(--primary)' }}>{stats?.attemptsSaved || 0}</div>
        </div>
      </div>

      <div className="circuit-strip">
        <span style={{ color: '#aaa', alignSelf: 'center', marginRight: '1rem', textTransform: 'uppercase', fontSize: '0.875rem', fontWeight: 600 }}>
          Dependency Status
        </span>
        {['payment-gateway', 'email-provider', 'report-database'].map(dep => {
          const isDown = simState?.outages?.find(o => o.dependency === dep)?.isDown;
          return (
            <span key={dep} className={`badge ${isDown ? 'open' : 'closed'}`}>
              {dep}: {isDown ? 'OPEN' : 'CLOSED'}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ── Jobs Tab ─────────────────────────────────────────────────────────────────
function JobsTab() {
  const [statusFilter, setStatusFilter] = useState('');
  const { data: jobs } = usePolling(() => api.getJobs(statusFilter || undefined));
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  const [name, setName] = useState('');
  const [type, setType] = useState('PAYMENT');
  const [priority, setPriority] = useState('Normal');
  const [maxRetries, setMaxRetries] = useState(3);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.enqueueJob({ name: name || `${type} manual`, type, priority, maxRetries });
    setName('');
  };

  return (
    <div>
      <form className="filters" onSubmit={handleCreate}>
        <div className="form-group">
          <label>Name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Job Name (optional)" />
        </div>
        <div className="form-group">
          <label>Type</label>
          <select value={type} onChange={e => setType(e.target.value)}>
            <option>PAYMENT</option>
            <option>EMAIL</option>
            <option>REPORT</option>
            <option>FLAKY</option>
            <option>ALWAYS_FAIL</option>
          </select>
        </div>
        <div className="form-group">
          <label>Priority</label>
          <select value={priority} onChange={e => setPriority(e.target.value)}>
            <option>High</option>
            <option>Normal</option>
            <option>Low</option>
          </select>
        </div>
        <div className="form-group">
          <label>Max Retries</label>
          <input type="number" value={maxRetries} onChange={e => setMaxRetries(parseInt(e.target.value))} min={0} max={10} />
        </div>
        <button type="submit">Create Job</button>
      </form>

      <div className="filters">
        <div className="form-group">
          <label>Filter by Status</label>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All</option>
            <option value="Queued">Queued</option>
            <option value="Processing">Processing</option>
            <option value="Retrying">Retrying</option>
            <option value="Held">Held</option>
            <option value="Succeeded">Succeeded</option>
            <option value="Dead">Dead</option>
          </select>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Priority</th>
            <th>Status</th>
            <th>Attempts</th>
            <th>Dependency</th>
            <th>Next Run</th>
            <th>Last Error</th>
          </tr>
        </thead>
        <tbody>
          {jobs?.map(job => (
            <tr key={job.id} className="clickable-row" onClick={() => setSelectedJob(job)}>
              <td>{job.name}</td>
              <td>{job.type}</td>
              <td>{job.priority}</td>
              <td><span className={`badge ${job.status.toLowerCase()}`}>{job.status}</span></td>
              <td>{job.attempts} / {job.maxRetries}</td>
              <td>{job.dependency}</td>
              <td>{job.nextRunAt ? new Date(job.nextRunAt).toLocaleTimeString() : '-'}</td>
              <td>{job.lastFingerprint ? job.lastFingerprint.substring(0, 8) : '-'}</td>
            </tr>
          ))}
          {jobs?.length === 0 && (
            <tr><td colSpan={8} className="muted-text text-center">No jobs found.</td></tr>
          )}
        </tbody>
      </table>

      {selectedJob && <JobDrawer job={selectedJob} onClose={() => setSelectedJob(null)} />}
    </div>
  );
}

// ── Incidents Tab (The Showpiece) ────────────────────────────────────────────
function IncidentsTab() {
  const { data: circuits, refresh: refreshCircuits } = usePolling(api.getCircuits);
  const { data: blastRadius } = usePolling(api.getBlastRadius);
  const { data: failureGroups, refresh: refreshFailureGroups } = usePolling(api.getFailureGroups);
  const [replayingFp, setReplayingFp] = useState<string | null>(null);

  const handleReplayGroup = async (fingerprint: string) => {
    setReplayingFp(fingerprint);
    try {
      const res = await api.replayGroup(fingerprint);
      alert(`Replayed ${res.replayed} dead job(s).`);
      refreshFailureGroups();
      refreshCircuits();
    } catch (err: any) {
      alert(`Replay failed: ${err.message}`);
    } finally {
      setReplayingFp(null);
    }
  };

  return (
    <div className="incidents-container">
      {/* 1a. Circuit Cards */}
      <section className="section-block">
        <h2 className="section-title">Circuit Breakers</h2>
        <div className="grid circuit-cards-grid">
          {circuits?.map(c => (
            <div key={c.dependency} className="stat-tile circuit-card">
              <div className="circuit-card-header">
                <span className="circuit-dep-name">{c.dependency}</span>
                <span className={`badge ${c.state.toLowerCase()}`}>{c.state}</span>
              </div>
              <div className="circuit-metrics">
                <div className="metric-row">
                  <span className="metric-label">Failures in window:</span>
                  <span className="metric-val">{c.failureCount}</span>
                </div>
                <div className="metric-row">
                  <span className="metric-label">Incident opened:</span>
                  <span className="metric-val">{c.incidentOpenedTime ? formatRelativeTime(c.incidentOpenedTime) : 'None'}</span>
                </div>
                <div className="metric-row">
                  <span className="metric-label">Jobs held:</span>
                  <span className="metric-val" style={{ color: 'var(--held)', fontWeight: 'bold' }}>{c.jobsHeld}</span>
                </div>
                <div className="metric-row">
                  <span className="metric-label">Retry attempts saved:</span>
                  <span className="metric-val" style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{c.attemptsSaved}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 1b. Blast-Radius Map */}
      <section className="section-block">
        <h2 className="section-title">Blast-Radius Map</h2>
        <p className="section-subtitle">Real-time dependency isolation and protected retry workload</p>
        <div className="blast-radius-map">
          {blastRadius?.map(item => (
            <div key={item.dependency} className="blast-row">
              {/* Col 1: Dependency node */}
              <div className={`blast-col dep-col ${item.circuitState.toLowerCase()}`}>
                <div className="dep-name">{item.dependency}</div>
                <span className={`badge ${item.circuitState.toLowerCase()}`}>{item.circuitState}</span>
              </div>

              {/* Connecting CSS Arrow 1 */}
              <div className="css-arrow">
                <div className="arrow-line"></div>
                <div className="arrow-head"></div>
              </div>

              {/* Col 2: Job type chips */}
              <div className="blast-col job-types-col">
                <div className="col-header">Affected Types</div>
                <div className="chip-list">
                  {item.jobTypes.map(t => (
                    <span key={t} className="job-chip">{t}</span>
                  ))}
                </div>
              </div>

              {/* Connecting CSS Arrow 2 */}
              <div className="css-arrow">
                <div className="arrow-line"></div>
                <div className="arrow-head"></div>
              </div>

              {/* Col 3: Status counters & totals */}
              <div className="blast-col status-counters-col">
                <div className="counters-row">
                  <span className="counter held">Held: <strong>{item.held}</strong></span>
                  <span className="counter queued">Queued: <strong>{item.queued}</strong></span>
                  <span className="counter retrying">Retrying: <strong>{item.retrying}</strong></span>
                  <span className="counter dead">Dead: <strong>{item.dead}</strong></span>
                  <span className="counter succeeded">Succeeded: <strong>{item.succeeded}</strong></span>
                </div>
                <div className="blast-totals">
                  <span className="total-pill affected">Total Affected: <strong>{item.totalAffected}</strong></span>
                  <span className="total-pill saved">Attempts Saved: <strong>{item.attemptsSavedTotal}</strong></span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 1c. Failure DNA Section */}
      <section className="section-block">
        <h2 className="section-title">Failure DNA (Root Causes)</h2>
        {failureGroups?.length === 0 ? (
          <p className="muted-text">No failure fingerprints detected.</p>
        ) : (
          <div className="grid failure-dna-grid">
            {failureGroups?.map(g => (
              <div key={g.fingerprint} className="stat-tile failure-dna-card">
                <div className="dna-header">
                  <h3 className="dna-title">{g.title}</h3>
                  <code className="fingerprint-badge" title="Normalized Fingerprint">{g.fingerprint}</code>
                </div>
                <div className="dna-sample">
                  <strong>Sample:</strong> {g.sampleMessage}
                </div>
                <div className="dna-meta-grid">
                  <div><strong>Failures:</strong> {g.failureCount}</div>
                  <div><strong>Affected Jobs:</strong> {g.affectedJobs}</div>
                  <div><strong>First Seen:</strong> {formatRelativeTime(g.firstSeen)}</div>
                  <div><strong>Last Seen:</strong> {formatRelativeTime(g.lastSeen)}</div>
                </div>
                <div className="dna-types">
                  <span className="metric-label">Job types:</span>
                  {g.affectedJobTypes.map(t => (
                    <span key={t} className="job-chip mini">{t}</span>
                  ))}
                </div>
                {g.deadCount > 0 && (
                  <div className="dna-actions">
                    <button
                      className="replay-group-btn"
                      disabled={replayingFp === g.fingerprint}
                      onClick={() => handleReplayGroup(g.fingerprint)}
                    >
                      {replayingFp === g.fingerprint ? 'Replaying...' : `Replay dead jobs (${g.deadCount})`}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Dead Letter Tab ──────────────────────────────────────────────────────────
function DeadLetterTab() {
  const { data: deadLetters, refresh } = usePolling(api.getDeadLetters);
  const [groupByFp, setGroupByFp] = useState(false);
  const [replayingId, setReplayingId] = useState<number | null>(null);
  const [replayingFp, setReplayingFp] = useState<string | null>(null);

  const handleReplaySingle = async (id: number) => {
    setReplayingId(id);
    try {
      await api.replayDeadLetter(id);
      refresh();
    } catch (err: any) {
      alert(`Replay failed: ${err.message}`);
    } finally {
      setReplayingId(null);
    }
  };

  const handleReplayGroup = async (fingerprint: string, count: number) => {
    if (!window.confirm(`Replay ${count} dead job(s) with fingerprint "${fingerprint}"?`)) {
      return;
    }
    setReplayingFp(fingerprint);
    try {
      const res = await api.replayGroup(fingerprint);
      alert(`Successfully replayed ${res.replayed} job(s).`);
      refresh();
    } catch (err: any) {
      alert(`Replay failed: ${err.message}`);
    } finally {
      setReplayingFp(null);
    }
  };

  // Grouping helper
  const grouped = React.useMemo(() => {
    if (!deadLetters) return {};
    const map: Record<string, DeadLetter[]> = {};
    for (const item of deadLetters) {
      if (!map[item.fingerprint]) map[item.fingerprint] = [];
      map[item.fingerprint].push(item);
    }
    return map;
  }, [deadLetters]);

  return (
    <div>
      <div className="tab-actions-bar">
        <h2>Dead Letter Queue ({deadLetters?.length || 0})</h2>
        <div className="toggle-container">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={groupByFp}
              onChange={e => setGroupByFp(e.target.checked)}
            />
            Group by Fingerprint
          </label>
        </div>
      </div>

      {!groupByFp ? (
        <table>
          <thead>
            <tr>
              <th>Job Name</th>
              <th>Type</th>
              <th>Attempts</th>
              <th>Final Error</th>
              <th>Fingerprint</th>
              <th>Failed At</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {deadLetters?.map(row => (
              <tr key={row.id}>
                <td>{row.jobName || row.jobId.substring(0, 8)}</td>
                <td><span className="job-chip mini">{row.jobType}</span></td>
                <td>{row.attempts}</td>
                <td className="error-text" title={row.finalError}>{row.finalError}</td>
                <td><code>{row.fingerprint.substring(0, 10)}</code></td>
                <td>{new Date(row.failedAt).toLocaleTimeString()}</td>
                <td>
                  <button
                    className="action-btn small"
                    disabled={replayingId === row.id}
                    onClick={() => handleReplaySingle(row.id)}
                  >
                    {replayingId === row.id ? 'Replaying...' : 'Replay'}
                  </button>
                </td>
              </tr>
            ))}
            {deadLetters?.length === 0 && (
              <tr><td colSpan={7} className="muted-text text-center">Dead letter queue is empty.</td></tr>
            )}
          </tbody>
        </table>
      ) : (
        <div className="grid dead-groups-grid">
          {Object.entries(grouped).map(([fp, items]) => (
            <div key={fp} className="stat-tile group-card">
              <div className="group-card-header">
                <div>
                  <strong>Fingerprint: </strong>
                  <code>{fp}</code>
                </div>
                <span className="badge dead">{items.length} Dead</span>
              </div>
              <p className="group-error-sample">{items[0]?.finalError}</p>
              <div className="group-meta">
                <span>Types: {[...new Set(items.map(i => i.jobType))].join(', ')}</span>
                <span>Last failed: {formatRelativeTime(items[0]?.failedAt)}</span>
              </div>
              <button
                className="replay-group-btn"
                disabled={replayingFp === fp}
                onClick={() => handleReplayGroup(fp, items.length)}
              >
                {replayingFp === fp ? 'Replaying...' : `Replay group (${items.length} jobs)`}
              </button>
            </div>
          ))}
          {Object.keys(grouped).length === 0 && (
            <p className="muted-text">Dead letter queue is empty.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Timeline Tab ─────────────────────────────────────────────────────────────
function TimelineTab() {
  const { data: timeline } = usePolling(() => api.getTimeline(150));
  const [filter, setFilter] = useState<'All' | 'Circuit' | 'Jobs' | 'Crashes'>('All');

  const filteredEvents = React.useMemo(() => {
    if (!timeline) return [];
    return timeline.filter(e => {
      if (filter === 'All') return true;
      if (filter === 'Circuit') {
        return e.type.startsWith('Circuit') || e.type.startsWith('Outage');
      }
      if (filter === 'Jobs') {
        return e.type.startsWith('Job') || e.type.startsWith('Retry');
      }
      if (filter === 'Crashes') {
        return e.type.includes('Lease') || e.type.includes('Crash') || e.type.includes('Worker');
      }
      return true;
    });
  }, [timeline, filter]);

  const getDotClass = (type: string) => {
    if (type === 'CircuitOpened' || type === 'JobFailed' || type === 'JobDeadLettered') return 'dot-red';
    if (type === 'CircuitClosed' || type === 'JobSucceeded') return 'dot-green';
    if (type.startsWith('Circuit') || type === 'RetryScheduled') return 'dot-amber';
    if (type.startsWith('Outage')) return 'dot-purple';
    if (type.includes('Lease') || type.includes('Crash') || type.includes('Worker')) return 'dot-orange';
    return 'dot-gray';
  };

  return (
    <div>
      <div className="tab-actions-bar">
        <h2>Live Timeline Feed ({filteredEvents.length})</h2>
        <div className="filter-pill-group">
          {(['All', 'Circuit', 'Jobs', 'Crashes'] as const).map(f => (
            <button
              key={f}
              className={`filter-pill ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="timeline-feed">
        {filteredEvents.map(e => (
          <div key={e.id} className="timeline-feed-item">
            <span className={`event-dot ${getDotClass(e.type)}`} />
            <span className="event-timestamp">{new Date(e.at).toLocaleTimeString()}</span>
            <span className="event-type-badge">{e.type}</span>
            {e.dependency && e.dependency !== 'none' && (
              <span className="event-tag dep-tag">[{e.dependency}]</span>
            )}
            {e.jobId && (
              <span className="event-tag job-tag">Job:{e.jobId.substring(0, 8)}</span>
            )}
            <span className="event-msg">{e.message}</span>
          </div>
        ))}
        {filteredEvents.length === 0 && (
          <p className="muted-text text-center" style={{ padding: '2rem' }}>No events recorded for this filter.</p>
        )}
      </div>
    </div>
  );
}

// ── Simulator Tab ────────────────────────────────────────────────────────────
function SimulatorTab() {
  const { data: simState, refresh: refreshSim } = usePolling(api.simState);
  const [jobType, setJobType] = useState('PAYMENT');
  const [count, setCount] = useState(100);
  const [maxRetries, setMaxRetries] = useState(3);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSimEnqueue = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    try {
      const res = await api.simEnqueue({ type: jobType, count, maxRetries });
      alert(`Enqueued ${res.enqueued} ${jobType} jobs.`);
      refreshSim();
    } catch (err: any) {
      alert(`Enqueue error: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleQuickEnqueuePayment = async () => {
    setIsProcessing(true);
    try {
      await api.simEnqueue({ type: 'PAYMENT', count: 100, maxRetries: 3 });
      alert('Enqueued 100 PAYMENT jobs');
      refreshSim();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleOutageToggle = async (dependency: string, down: boolean) => {
    try {
      await api.simOutage({ dependency, down });
      refreshSim();
    } catch (err: any) {
      alert(`Outage toggle error: ${err.message}`);
    }
  };

  const handleKillWorker = async () => {
    try {
      const res = await api.simKillWorker();
      alert(`Worker crash queued: ${res.target}`);
      refreshSim();
    } catch (err: any) {
      alert(`Kill worker error: ${err.message}`);
    }
  };

  const handleReset = async () => {
    if (!window.confirm('RESET EVERYTHING: Are you sure you want to delete all jobs, events, dead letters, and reset simulators?')) {
      return;
    }
    try {
      await api.simReset();
      alert('System reset successfully.');
      refreshSim();
    } catch (err: any) {
      alert(`Reset error: ${err.message}`);
    }
  };

  const dependencies = ['payment-gateway', 'email-provider', 'report-database'];

  return (
    <div className="simulator-container">
      {/* Enqueue Form */}
      <section className="section-block">
        <h2 className="section-title">Bulk Enqueue Controls</h2>
        <form className="filters" onSubmit={handleSimEnqueue}>
          <div className="form-group">
            <label>Job Type</label>
            <select value={jobType} onChange={e => setJobType(e.target.value)}>
              <option>PAYMENT</option>
              <option>EMAIL</option>
              <option>REPORT</option>
              <option>FLAKY</option>
              <option>ALWAYS_FAIL</option>
            </select>
          </div>
          <div className="form-group">
            <label>Count</label>
            <input
              type="number"
              value={count}
              min={1}
              max={500}
              onChange={e => setCount(parseInt(e.target.value) || 1)}
            />
          </div>
          <div className="form-group">
            <label>Max Retries</label>
            <input
              type="number"
              value={maxRetries}
              min={0}
              max={10}
              onChange={e => setMaxRetries(parseInt(e.target.value) || 0)}
            />
          </div>
          <button type="submit" disabled={isProcessing}>
            {isProcessing ? 'Enqueuing...' : `Enqueue ${count} Jobs`}
          </button>
        </form>
      </section>

      {/* Quick Action Buttons & Outage Controls */}
      <section className="section-block">
        <h2 className="section-title">Fault Injection & Actions</h2>
        <div className="quick-actions-bar">
          <button className="action-btn" onClick={handleQuickEnqueuePayment} disabled={isProcessing}>
            Enqueue 100 PAYMENT jobs
          </button>
          <button
            className="action-btn warning"
            onClick={() => handleOutageToggle('payment-gateway', true)}
          >
            Start payment-gateway outage
          </button>
          <button
            className="action-btn success"
            onClick={() => handleOutageToggle('payment-gateway', false)}
          >
            End outage
          </button>
          <button className="action-btn danger" onClick={handleKillWorker}>
            Kill a worker
          </button>
          <button className="action-btn reset" onClick={handleReset}>
            Reset everything
          </button>
        </div>

        <h3 style={{ marginTop: '1.5rem', marginBottom: '0.75rem' }}>Dependency Outage Toggles</h3>
        <div className="grid outage-toggles-grid">
          {dependencies.map(dep => {
            const isDown = !!simState?.outages?.find(o => o.dependency === dep)?.isDown;
            return (
              <div key={dep} className="stat-tile outage-card">
                <div>
                  <strong>{dep}</strong>
                  <div style={{ marginTop: '0.25rem' }}>
                    <span className={`badge ${isDown ? 'open' : 'closed'}`}>
                      {isDown ? 'OUTAGE ACTIVE' : 'HEALTHY'}
                    </span>
                  </div>
                </div>
                <button
                  className={`action-btn ${isDown ? 'success' : 'warning'}`}
                  onClick={() => handleOutageToggle(dep, !isDown)}
                >
                  {isDown ? 'End Outage' : 'Trigger Outage'}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Worker Grid */}
      <section className="section-block">
        <h2 className="section-title">Worker Pool Status</h2>
        <div className="grid worker-grid">
          {simState?.workers?.map(w => {
            const stateLower = w.state.toLowerCase();
            return (
              <div key={w.id} className={`stat-tile worker-card ${stateLower}`}>
                <div className="worker-header">
                  <span className="worker-id">{w.id}</span>
                  <span className={`badge ${stateLower}`}>{w.state}</span>
                </div>
                <div className="worker-job">
                  <span className="metric-label">Current Job:</span>
                  <div className="job-id-preview">
                    {w.currentJobId ? <code>{w.currentJobId}</code> : <span className="muted-text">Idle</span>}
                  </div>
                </div>
              </div>
            );
          })}
          {simState?.workers?.length === 0 && (
            <p className="muted-text">No active workers found.</p>
          )}
        </div>
      </section>
    </div>
  );
}

// ── Main App Shell ───────────────────────────────────────────────────────────
export default function App() {
  const [activeTab, setActiveTab] = useState('Overview');
  const [apiReachable, setApiReachable] = useState(true);

  useEffect(() => {
    const checkApi = async () => {
      try {
        await api.getStats();
        setApiReachable(true);
      } catch {
        setApiReachable(false);
      }
    };
    checkApi();
    const id = setInterval(checkApi, 2000);
    return () => clearInterval(id);
  }, []);

  return (
    <div>
      <div className="header">
        <h1 className="header-title">
          Reliable Job Processor
          <div
            className={`connection-indicator ${apiReachable ? '' : 'error'}`}
            title={apiReachable ? 'API Connected' : 'API Unreachable'}
          />
        </h1>
      </div>
      <div className="nav-tabs">
        {['Overview', 'Jobs', 'Dead Letter', 'Incidents', 'Timeline', 'Simulator'].map(tab => (
          <button
            key={tab}
            className={`nav-tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>
      <div className="container">
        {activeTab === 'Overview' && <OverviewTab />}
        {activeTab === 'Jobs' && <JobsTab />}
        {activeTab === 'Incidents' && <IncidentsTab />}
        {activeTab === 'Dead Letter' && <DeadLetterTab />}
        {activeTab === 'Timeline' && <TimelineTab />}
        {activeTab === 'Simulator' && <SimulatorTab />}
      </div>
    </div>
  );
}
