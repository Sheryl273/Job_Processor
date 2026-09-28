import React, { useState, useEffect, useRef, useMemo } from 'react';
import { api, type DeadLetter } from './api';
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

// ── Popout Signal Interface ──────────────────────────────────────────────────
export interface PopoutSignal {
  id: string;
  type: 'critical' | 'warning' | 'circuit' | 'lease' | 'success' | 'info';
  title: string;
  message: string;
  timestamp: Date;
  jobId?: string;
  dependency?: string;
  fingerprint?: string;
  targetTab?: string;
}

// ── Job Details Drawer ────────────────────────────────────────────────────────
function JobDrawer({
  jobId,
  onClose,
  onSignal,
}: {
  jobId: string;
  onClose: () => void;
  onSignal: (s: Omit<PopoutSignal, 'id' | 'timestamp'>) => void;
}) {
  const { data, refresh } = usePolling(() => api.getJob(jobId), 1500);
  const [retrying, setRetrying] = useState(false);

  const job = data?.job;
  const failures = data?.failures;
  const events = data?.events;

  const handleRetryJob = async () => {
    if (!job) return;
    setRetrying(true);
    try {
      await api.retryJob(job.id);
      onSignal({
        type: 'success',
        title: 'Job Requeued',
        message: `Job ${job.name || job.id.substring(0, 8)} reset to Queued.`,
        jobId: job.id,
      });
      refresh();
    } catch (err: any) {
      onSignal({
        type: 'critical',
        title: 'Retry Failed',
        message: err.message,
        jobId: job.id,
      });
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={e => e.stopPropagation()}>
        <h2>
          <span>Job Details</span>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </h2>

        {!job ? (
          <p className="muted-text">Loading job details...</p>
        ) : (
          <>
            <div className="job-details-grid">
              <div className="job-detail-item"><strong>ID</strong> <code>{job.id}</code></div>
              <div className="job-detail-item"><strong>Name</strong> {job.name}</div>
              <div className="job-detail-item"><strong>Type</strong> {job.type}</div>
              <div className="job-detail-item">
                <strong>Status</strong> <span className={`badge ${job.status.toLowerCase()}`}>{job.status}</span>
              </div>
              <div className="job-detail-item"><strong>Priority</strong> {job.priority}</div>
              <div className="job-detail-item"><strong>Dependency</strong> {job.dependency}</div>
              <div className="job-detail-item"><strong>Attempts</strong> {job.attempts} / {job.maxRetries}</div>
              <div className="job-detail-item"><strong>Attempts Saved</strong> {job.attemptsSaved || 0}</div>
              <div className="job-detail-item"><strong>Next Run At</strong> {job.nextRunAt ? new Date(job.nextRunAt).toLocaleTimeString() : 'None'}</div>
              <div className="job-detail-item"><strong>Created At</strong> {new Date(job.createdAt).toLocaleTimeString()}</div>
            </div>

            {job.status === 'Dead' && (
              <div style={{ marginBottom: '1.5rem' }}>
                <button
                  className="action-btn success"
                  style={{ width: '100%', padding: '0.65rem' }}
                  disabled={retrying}
                  onClick={handleRetryJob}
                >
                  {retrying ? 'Retrying...' : 'Replay / Retry This Dead Job Now'}
                </button>
              </div>
            )}

            <h3>Failure History ({failures?.length || 0})</h3>
            {failures?.length === 0 ? (
              <p className="muted-text">No failures recorded for this job.</p>
            ) : (
              failures?.map(f => (
                <div key={f.id} className="history-item">
                  <div><strong>Attempt {f.attempt}</strong> ({new Date(f.at).toLocaleTimeString()})</div>
                  <div><strong>Type:</strong> {f.exceptionType}</div>
                  <div><strong>Message:</strong> {f.message}</div>
                  <div><strong>Fingerprint:</strong> <code>{f.fingerprint}</code></div>
                  {f.stackTrace && (
                    <details style={{ marginTop: '0.4rem' }}>
                      <summary>Stack Trace</summary>
                      <pre>{f.stackTrace}</pre>
                    </details>
                  )}
                </div>
              ))
            )}

            <h3 style={{ marginTop: '1.5rem' }}>Event Timeline ({events?.length || 0})</h3>
            {events?.length === 0 ? (
              <p className="muted-text">No events logged.</p>
            ) : (
              events?.map(e => (
                <div key={e.id} className="history-item" style={{ padding: '0.65rem 0.85rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#8b949e', marginBottom: '4px' }}>
                    <strong style={{ color: 'var(--primary)' }}>{e.type}</strong>
                    <span>{new Date(e.at).toLocaleTimeString()}</span>
                  </div>
                  <div style={{ fontSize: '0.85rem' }}>{e.message}</div>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Pop-out Signal Card Component (Slow, Readable, Clickable) ────────────────
function SignalCard({
  signal,
  durationMs,
  onDismiss,
  onSelectJob,
  onSelectTab,
}: {
  signal: PopoutSignal;
  durationMs: number;
  onDismiss: (id: string) => void;
  onSelectJob: (jobId: string) => void;
  onSelectTab: (tab: string) => void;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [remainingMs, setRemainingMs] = useState(durationMs);
  const isInfinite = durationMs === Infinity;

  useEffect(() => {
    if (isInfinite) return;
    if (isHovered) return; // Pause countdown while reading!

    const stepMs = 100;
    const interval = setInterval(() => {
      setRemainingMs(prev => {
        if (prev <= stepMs) {
          clearInterval(interval);
          onDismiss(signal.id);
          return 0;
        }
        return prev - stepMs;
      });
    }, stepMs);

    return () => clearInterval(interval);
  }, [isHovered, isInfinite, durationMs, onDismiss, signal.id]);

  const progressPercent = isInfinite ? 100 : Math.max(0, (remainingMs / durationMs) * 100);

  const handleClickCard = () => {
    if (signal.jobId) {
      onSelectJob(signal.jobId);
    } else if (signal.targetTab) {
      onSelectTab(signal.targetTab);
    }
  };

  return (
    <div
      className={`signal-popout-card ${signal.type}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleClickCard}
      title="Click to view details"
    >
      <div className="signal-header-row">
        <div className="signal-title-area">
          <span className="signal-title-text">{signal.title}</span>
          <span className="signal-timestamp">{signal.timestamp.toLocaleTimeString()}</span>
          {isHovered && <span className="signal-reading-badge">Reading Paused</span>}
        </div>
        <button
          className="signal-close-icon"
          title="Dismiss signal"
          onClick={e => {
            e.stopPropagation();
            onDismiss(signal.id);
          }}
        >
          &times;
        </button>
      </div>

      <p className="signal-body-text">{signal.message}</p>

      <div className="signal-tags-row">
        {signal.dependency && (
          <span className="event-tag dep-tag">[{signal.dependency}]</span>
        )}
        {signal.jobId && (
          <span className="event-tag job-tag">Job: {signal.jobId.substring(0, 8)}</span>
        )}
        {signal.fingerprint && (
          <code style={{ fontSize: '0.72rem' }}>FP: {signal.fingerprint.substring(0, 8)}</code>
        )}
      </div>

      <div className="signal-action-row" onClick={e => e.stopPropagation()}>
        <div className="signal-action-buttons">
          {signal.jobId && (
            <button
              className="signal-inspect-btn"
              onClick={() => onSelectJob(signal.jobId!)}
            >
              Inspect Job ↗
            </button>
          )}
          {signal.targetTab && (
            <button
              className="signal-tab-btn"
              onClick={() => onSelectTab(signal.targetTab!)}
            >
              Go to {signal.targetTab} ↗
            </button>
          )}
        </div>
        <button
          className="signals-toolbar-btn"
          onClick={() => onDismiss(signal.id)}
        >
          Dismiss
        </button>
      </div>

      {/* Slow progress bar */}
      <div className="signal-progress-track">
        <div
          className="signal-progress-fill"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  );
}

// ── Overview Tab ─────────────────────────────────────────────────────────────
function OverviewTab({ onSelectTab }: { onSelectTab: (tab: string) => void }) {
  const { data: stats } = usePolling(api.getStats);
  const { data: simState } = usePolling(api.simState);

  return (
    <div>
      <div className="grid">
        <div className="stat-tile clickable-row" onClick={() => onSelectTab('Jobs')}>
          <div className="stat-title">Total Jobs</div>
          <div className="stat-value">{stats?.total || 0}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-title">Queued</div>
          <div className="stat-value">{stats?.queued || 0}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-title">Processing</div>
          <div className="stat-value" style={{ color: 'var(--processing)' }}>{stats?.processing || 0}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-title">Retrying</div>
          <div className="stat-value" style={{ color: 'var(--retrying)' }}>{stats?.retrying || 0}</div>
        </div>
        <div className="stat-tile clickable-row" onClick={() => onSelectTab('Incidents')}>
          <div className="stat-title">Held by Circuit</div>
          <div className="stat-value" style={{ color: 'var(--held)' }}>{stats?.held || 0}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-title">Succeeded</div>
          <div className="stat-value" style={{ color: 'var(--succeeded)' }}>{stats?.succeeded || 0}</div>
        </div>
        <div className="stat-tile clickable-row" onClick={() => onSelectTab('Dead Letter')}>
          <div className="stat-title">Dead Letter</div>
          <div className="stat-value" style={{ color: 'var(--dead)' }}>{stats?.dead || 0}</div>
        </div>
        <div className="stat-tile highlight-tile clickable-row" onClick={() => onSelectTab('Incidents')}>
          <div className="stat-title">Retries Saved by Circuit</div>
          <div className="stat-value" style={{ color: 'var(--primary)' }}>{stats?.attemptsSaved || 0}</div>
        </div>
      </div>

      <div className="circuit-strip">
        <span style={{ color: '#8b949e', alignSelf: 'center', marginRight: '1rem', textTransform: 'uppercase', fontSize: '0.8rem', fontWeight: 700 }}>
          Live Dependency Circuits
        </span>
        {['payment-gateway', 'email-provider', 'report-database'].map(dep => {
          const isDown = simState?.outages?.find(o => o.dependency === dep)?.isDown;
          return (
            <span
              key={dep}
              className={`badge ${isDown ? 'open' : 'closed'}`}
              style={{ cursor: 'pointer' }}
              onClick={() => onSelectTab('Incidents')}
              title="Click to view in Incidents tab"
            >
              {dep}: {isDown ? 'OPEN (OUTAGE)' : 'CLOSED (HEALTHY)'}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ── Jobs Tab ─────────────────────────────────────────────────────────────────
function JobsTab({
  onSelectJob,
  onSignal,
}: {
  onSelectJob: (jobId: string) => void;
  onSignal: (s: Omit<PopoutSignal, 'id' | 'timestamp'>) => void;
}) {
  const [statusFilter, setStatusFilter] = useState('');
  const { data: jobs, refresh } = usePolling(() => api.getJobs(statusFilter || undefined));

  const [name, setName] = useState('');
  const [type, setType] = useState('PAYMENT');
  const [priority, setPriority] = useState('Normal');
  const [maxRetries, setMaxRetries] = useState(3);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await api.enqueueJob({ name: name || `${type} manual`, type, priority, maxRetries });
      onSignal({
        type: 'info',
        title: 'Job Created',
        message: `Enqueued ${created.name} (${created.type}) with priority ${created.priority}`,
        jobId: created.id,
      });
      setName('');
      refresh();
    } catch (err: any) {
      onSignal({
        type: 'critical',
        title: 'Creation Failed',
        message: err.message,
      });
    }
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
          <input type="number" value={maxRetries} onChange={e => setMaxRetries(parseInt(e.target.value) || 0)} min={0} max={10} />
        </div>
        <button type="submit">Create Job</button>
      </form>

      <div className="filters">
        <div className="form-group">
          <label>Filter by Status</label>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All Statuses</option>
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
            <th>Last Fingerprint</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {jobs?.map(job => (
            <tr key={job.id} className="clickable-row" onClick={() => onSelectJob(job.id)}>
              <td><strong>{job.name}</strong></td>
              <td><span className="job-chip mini">{job.type}</span></td>
              <td>{job.priority}</td>
              <td><span className={`badge ${job.status.toLowerCase()}`}>{job.status}</span></td>
              <td>{job.attempts} / {job.maxRetries}</td>
              <td>{job.dependency}</td>
              <td>{job.nextRunAt ? new Date(job.nextRunAt).toLocaleTimeString() : '-'}</td>
              <td>{job.lastFingerprint ? <code>{job.lastFingerprint.substring(0, 8)}</code> : '-'}</td>
              <td>
                <button
                  className="action-btn small"
                  onClick={e => {
                    e.stopPropagation();
                    onSelectJob(job.id);
                  }}
                >
                  Inspect ↗
                </button>
              </td>
            </tr>
          ))}
          {jobs?.length === 0 && (
            <tr><td colSpan={9} className="muted-text text-center" style={{ padding: '2rem' }}>No jobs found.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Incidents Tab (The Showpiece) ────────────────────────────────────────────
function IncidentsTab({
  onSignal,
}: {
  onSignal: (s: Omit<PopoutSignal, 'id' | 'timestamp'>) => void;
}) {
  const { data: circuits, refresh: refreshCircuits } = usePolling(api.getCircuits);
  const { data: blastRadius } = usePolling(api.getBlastRadius);
  const { data: failureGroups, refresh: refreshFailureGroups } = usePolling(api.getFailureGroups);
  const [replayingFp, setReplayingFp] = useState<string | null>(null);

  const handleReplayGroup = async (fingerprint: string) => {
    setReplayingFp(fingerprint);
    try {
      const res = await api.replayGroup(fingerprint);
      onSignal({
        type: 'success',
        title: 'Group Replay Started',
        message: `Successfully requeued ${res.replayed} dead job(s) for fingerprint ${fingerprint.substring(0, 8)}.`,
        fingerprint,
        targetTab: 'Jobs',
      });
      refreshFailureGroups();
      refreshCircuits();
    } catch (err: any) {
      onSignal({
        type: 'critical',
        title: 'Replay Failed',
        message: err.message,
        fingerprint,
      });
    } finally {
      setReplayingFp(null);
    }
  };

  return (
    <div className="incidents-container">
      {/* 1a. Circuit Cards */}
      <section className="section-block">
        <h2 className="section-title">Circuit Breakers</h2>
        <p className="section-subtitle">Real-time health monitor and retry suppression per external dependency</p>
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
        <p className="section-subtitle">Normalized exception patterns grouped by canonical SHA-256 fingerprint</p>
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
                  <div className="dna-actions" style={{ marginTop: '0.5rem' }}>
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
function DeadLetterTab({
  onSelectJob,
  onSignal,
}: {
  onSelectJob: (jobId: string) => void;
  onSignal: (s: Omit<PopoutSignal, 'id' | 'timestamp'>) => void;
}) {
  const { data: deadLetters, refresh } = usePolling(api.getDeadLetters);
  const [groupByFp, setGroupByFp] = useState(false);
  const [replayingId, setReplayingId] = useState<number | null>(null);
  const [replayingFp, setReplayingFp] = useState<string | null>(null);

  const handleReplaySingle = async (id: number, jobId: string) => {
    setReplayingId(id);
    try {
      await api.replayDeadLetter(id);
      onSignal({
        type: 'success',
        title: 'Job Requeued',
        message: `Dead letter #${id} re-queued to active pipeline.`,
        jobId,
        targetTab: 'Jobs',
      });
      refresh();
    } catch (err: any) {
      onSignal({
        type: 'critical',
        title: 'Replay Failed',
        message: err.message,
        jobId,
      });
    } finally {
      setReplayingId(null);
    }
  };

  const handleReplayGroup = async (fingerprint: string, count: number) => {
    setReplayingFp(fingerprint);
    try {
      const res = await api.replayGroup(fingerprint);
      onSignal({
        type: 'success',
        title: 'Bulk Replay Complete',
        message: `Requeued ${res.replayed} of ${count} dead job(s) for fingerprint ${fingerprint.substring(0, 8)}.`,
        fingerprint,
        targetTab: 'Jobs',
      });
      refresh();
    } catch (err: any) {
      onSignal({
        type: 'critical',
        title: 'Group Replay Failed',
        message: err.message,
        fingerprint,
      });
    } finally {
      setReplayingFp(null);
    }
  };

  const grouped = useMemo(() => {
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
              <tr key={row.id} className="clickable-row" onClick={() => onSelectJob(row.jobId)}>
                <td><strong>{row.jobName || row.jobId.substring(0, 8)}</strong></td>
                <td><span className="job-chip mini">{row.jobType}</span></td>
                <td>{row.attempts}</td>
                <td className="error-text" title={row.finalError}>{row.finalError}</td>
                <td><code>{row.fingerprint.substring(0, 10)}</code></td>
                <td>{new Date(row.failedAt).toLocaleTimeString()}</td>
                <td>
                  <div style={{ display: 'flex', gap: '6px' }} onClick={e => e.stopPropagation()}>
                    <button
                      className="action-btn small success"
                      disabled={replayingId === row.id}
                      onClick={() => handleReplaySingle(row.id, row.jobId)}
                    >
                      {replayingId === row.id ? 'Replaying...' : 'Replay'}
                    </button>
                    <button
                      className="action-btn small"
                      onClick={() => onSelectJob(row.jobId)}
                    >
                      Inspect ↗
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {deadLetters?.length === 0 && (
              <tr><td colSpan={7} className="muted-text text-center" style={{ padding: '2rem' }}>Dead letter queue is empty.</td></tr>
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
function TimelineTab({
  onSelectJob,
  onSelectTab,
}: {
  onSelectJob: (jobId: string) => void;
  onSelectTab: (tab: string) => void;
}) {
  const { data: timeline } = usePolling(() => api.getTimeline(150), 1500);
  const [filter, setFilter] = useState<'All' | 'Circuit' | 'Jobs' | 'Crashes'>('All');

  const filteredEvents = useMemo(() => {
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
        {filteredEvents.map(e => {
          const isClickable = !!e.jobId || e.type.startsWith('Circuit') || e.type.startsWith('Outage');
          return (
            <div
              key={e.id}
              className={`timeline-feed-item ${isClickable ? 'clickable' : ''}`}
              onClick={() => {
                if (e.jobId) {
                  onSelectJob(e.jobId);
                } else if (e.type.startsWith('Circuit') || e.type.startsWith('Outage')) {
                  onSelectTab('Incidents');
                }
              }}
              title={isClickable ? 'Click to inspect details' : undefined}
            >
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
              {isClickable && <span className="inspect-hint">Inspect ↗</span>}
            </div>
          );
        })}
        {filteredEvents.length === 0 && (
          <p className="muted-text text-center" style={{ padding: '2rem' }}>No events recorded for this filter.</p>
        )}
      </div>
    </div>
  );
}

// ── Simulator Tab ────────────────────────────────────────────────────────────
function SimulatorTab({
  onSignal,
}: {
  onSignal: (s: Omit<PopoutSignal, 'id' | 'timestamp'>) => void;
}) {
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
      onSignal({
        type: 'info',
        title: 'Bulk Enqueued',
        message: `Enqueued ${res.enqueued} ${jobType} jobs with MaxRetries=${maxRetries}.`,
        targetTab: 'Jobs',
      });
      refreshSim();
    } catch (err: any) {
      onSignal({
        type: 'critical',
        title: 'Enqueue Error',
        message: err.message,
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleQuickEnqueuePayment = async () => {
    setIsProcessing(true);
    try {
      await api.simEnqueue({ type: 'PAYMENT', count: 100, maxRetries: 3 });
      onSignal({
        type: 'info',
        title: 'Quick Enqueue',
        message: 'Enqueued 100 PAYMENT jobs targeting payment-gateway.',
        dependency: 'payment-gateway',
        targetTab: 'Jobs',
      });
      refreshSim();
    } catch (err: any) {
      onSignal({
        type: 'critical',
        title: 'Enqueue Error',
        message: err.message,
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleOutageToggle = async (dependency: string, down: boolean) => {
    try {
      await api.simOutage({ dependency, down });
      onSignal({
        type: down ? 'circuit' : 'success',
        title: down ? `🔴 Outage: ${dependency}` : `🟢 Restored: ${dependency}`,
        message: down
          ? `Downstream ${dependency} is OFFLINE. Circuit will open and bulk-hold matching jobs.`
          : `Downstream ${dependency} is ONLINE. Circuit closed; held jobs are releasing.`,
        dependency,
        targetTab: 'Incidents',
      });
      refreshSim();
    } catch (err: any) {
      onSignal({
        type: 'critical',
        title: 'Outage Toggle Error',
        message: err.message,
        dependency,
      });
    }
  };

  const handleKillWorker = async () => {
    try {
      const res = await api.simKillWorker();
      onSignal({
        type: 'warning',
        title: '💥 Worker Crash Armed',
        message: `Crash queued for: ${res.target}. Next claimed job will crash the worker to test LeaseReaper recovery.`,
        targetTab: 'Timeline',
      });
      refreshSim();
    } catch (err: any) {
      onSignal({
        type: 'critical',
        title: 'Kill Worker Error',
        message: err.message,
      });
    }
  };

  const handleReset = async () => {
    try {
      await api.simReset();
      onSignal({
        type: 'info',
        title: '🧹 System Reset',
        message: 'Database tables wiped and simulation state reset to clean baseline.',
        targetTab: 'Overview',
      });
      refreshSim();
    } catch (err: any) {
      onSignal({
        type: 'critical',
        title: 'Reset Error',
        message: err.message,
      });
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
            Kill a worker (Crash Sim)
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
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  // Pop-out Signals State
  const [signals, setSignals] = useState<PopoutSignal[]>([]);
  // Speed modes: slow = 20s, verySlow = 40s, manual = Infinity
  const [durationMode, setDurationMode] = useState<'slow' | 'verySlow' | 'manual'>('slow');

  const durationMs = useMemo(() => {
    if (durationMode === 'slow') return 20000;
    if (durationMode === 'verySlow') return 40000;
    return Infinity;
  }, [durationMode]);

  const pushSignal = (s: Omit<PopoutSignal, 'id' | 'timestamp'>) => {
    const newSignal: PopoutSignal = {
      ...s,
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date(),
    };
    setSignals(prev => [newSignal, ...prev.slice(0, 7)]); // Keep up to 8
  };

  const dismissSignal = (id: string) => {
    setSignals(prev => prev.filter(s => s.id !== id));
  };

  const clearAllSignals = () => {
    setSignals([]);
  };

  // Background monitor: check health and auto-detect critical events from timeline
  const seenEventIds = useRef<Set<string>>(new Set());
  const isFirstTimelineFetch = useRef(true);

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
    const id = setInterval(checkApi, 2500);
    return () => clearInterval(id);
  }, []);

  // Poll timeline to create Pop-out Signals for system events (crashes, circuit, dead letter, lease)
  useEffect(() => {
    const pollEvents = async () => {
      try {
        const events = await api.getTimeline(20);
        if (!events || events.length === 0) return;

        if (isFirstTimelineFetch.current) {
          // Initialize seen IDs so we don't spam on page load
          events.forEach(e => seenEventIds.current.add(e.id));
          isFirstTimelineFetch.current = false;
          return;
        }

        // Check for new events
        const newEvents = events.filter(e => !seenEventIds.current.has(e.id)).reverse();
        for (const e of newEvents) {
          seenEventIds.current.add(e.id);

          if (e.type === 'CircuitOpened') {
            pushSignal({
              type: 'circuit',
              title: `⚡ Circuit Opened: ${e.dependency}`,
              message: e.message,
              dependency: e.dependency || undefined,
              targetTab: 'Incidents',
            });
          } else if (e.type === 'CircuitClosed') {
            pushSignal({
              type: 'success',
              title: `✅ Circuit Recovered: ${e.dependency}`,
              message: e.message,
              dependency: e.dependency || undefined,
              targetTab: 'Incidents',
            });
          } else if (e.type === 'WorkerCrashed') {
            pushSignal({
              type: 'critical',
              title: '💥 Worker Crashed',
              message: e.message,
              jobId: e.jobId || undefined,
              targetTab: 'Timeline',
            });
          } else if (e.type === 'LeaseExpired') {
            pushSignal({
              type: 'lease',
              title: '⏱️ Lease Expired & Reclaimed',
              message: e.message,
              jobId: e.jobId || undefined,
              targetTab: 'Timeline',
            });
          } else if (e.type === 'JobDeadLettered') {
            pushSignal({
              type: 'critical',
              title: '💀 Job Moved to Dead Letter',
              message: e.message,
              jobId: e.jobId || undefined,
              targetTab: 'Dead Letter',
            });
          }
        }
      } catch {
        // ignore polling error
      }
    };

    pollEvents();
    const id = setInterval(pollEvents, 2500);
    return () => clearInterval(id);
  }, []);

  return (
    <div>
      {/* Top Header */}
      <div className="header">
        <h1 className="header-title">
          <span>Reliable Job Processor</span>
          <div
            className={`connection-indicator ${apiReachable ? '' : 'error'}`}
            title={apiReachable ? 'API Connected' : 'API Unreachable'}
          />
        </h1>
      </div>

      {/* Nav Tabs */}
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

      {/* Main Container */}
      <div className="container">
        {activeTab === 'Overview' && <OverviewTab onSelectTab={setActiveTab} />}
        {activeTab === 'Jobs' && <JobsTab onSelectJob={setSelectedJobId} onSignal={pushSignal} />}
        {activeTab === 'Incidents' && <IncidentsTab onSignal={pushSignal} />}
        {activeTab === 'Dead Letter' && <DeadLetterTab onSelectJob={setSelectedJobId} onSignal={pushSignal} />}
        {activeTab === 'Timeline' && <TimelineTab onSelectJob={setSelectedJobId} onSelectTab={setActiveTab} />}
        {activeTab === 'Simulator' && <SimulatorTab onSignal={pushSignal} />}
      </div>

      {/* Global Job Drawer */}
      {selectedJobId && (
        <JobDrawer
          jobId={selectedJobId}
          onClose={() => setSelectedJobId(null)}
          onSignal={pushSignal}
        />
      )}

      {/* ─────────────────────────────────────────────────────────────────────
          POPOUT SIGNALS & NOTIFICATION MONITOR (Slow, Readable, Clickable)
         ───────────────────────────────────────────────────────────────────── */}
      {signals.length > 0 && (
        <div className="signals-overlay">
          {/* Signal Control Toolbar */}
          <div className="signals-toolbar">
            <span>
              📡 <strong>Signals ({signals.length})</strong>
            </span>
            <div className="signals-toolbar-controls">
              <label style={{ fontSize: '0.75rem', color: '#8b949e' }}>
                Display Speed:
              </label>
              <select
                value={durationMode}
                onChange={e => setDurationMode(e.target.value as any)}
                title="Control how long signal popouts stay on screen"
              >
                <option value="slow">Slow (20s)</option>
                <option value="verySlow">Ultra-Slow (40s)</option>
                <option value="manual">Keep Open (Manual Dismiss)</option>
              </select>
              <button
                className="signals-toolbar-btn"
                onClick={clearAllSignals}
                title="Clear all pop-out signals"
              >
                Clear All
              </button>
            </div>
          </div>

          {/* Active Pop-out Signals */}
          {signals.slice(0, 4).map(signal => (
            <SignalCard
              key={signal.id}
              signal={signal}
              durationMs={durationMs}
              onDismiss={dismissSignal}
              onSelectJob={setSelectedJobId}
              onSelectTab={setActiveTab}
            />
          ))}
        </div>
      )}
    </div>
  );
}
