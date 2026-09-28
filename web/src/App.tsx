import { useState, useEffect } from 'react';
import { api, type Job } from './api';
import { usePolling } from './usePolling';
import './styles.css';

// --- Drawer Component ---
function JobDrawer({ job, onClose }: { job: Job, onClose: () => void }) {
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
          <div className="job-detail-item"><strong>Status</strong> <span className={`badge ${job.status.toLowerCase()}`}>{job.status}</span></div>
          <div className="job-detail-item"><strong>Priority</strong> {job.priority}</div>
          <div className="job-detail-item"><strong>Dependency</strong> {job.dependency}</div>
          <div className="job-detail-item"><strong>Attempts</strong> {job.attempts} / {job.maxRetries}</div>
          <div className="job-detail-item"><strong>Next Run At</strong> {job.nextRunAt ? new Date(job.nextRunAt).toLocaleString() : 'N/A'}</div>
          <div className="job-detail-item"><strong>Created At</strong> {new Date(job.createdAt).toLocaleString()}</div>
          <div className="job-detail-item"><strong>Reclaim Count</strong> {job.reclaimCount}</div>
        </div>

        <h3>Failure History</h3>
        {failures?.length === 0 ? <p>No failures.</p> : (
          failures?.map(f => (
            <div key={f.id} className="history-item">
              <div><strong>Attempt {f.attempt}</strong> ({new Date(f.at).toLocaleString()})</div>
              <div><strong>Type:</strong> {f.exceptionType}</div>
              <div><strong>Message:</strong> {f.message}</div>
              <div><strong>Fingerprint:</strong> {f.fingerprint}</div>
              <details>
                <summary>Stack Trace</summary>
                <pre>{f.stackTrace}</pre>
              </details>
            </div>
          ))
        )}

        <h3 className="timeline">Event Timeline</h3>
        {events?.length === 0 ? <p>No events.</p> : (
          events?.map(e => (
            <div key={e.id} className="timeline-item">
              <div className="timeline-time">{new Date(e.at).toLocaleString()} - {e.type}</div>
              <div>{e.message}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// --- Jobs Tab ---
function JobsTab() {
  const [statusFilter, setStatusFilter] = useState('');
  const { data: jobs } = usePolling(() => api.getJobs(statusFilter || undefined));
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  
  // Create job form state
  const [name, setName] = useState('');
  const [type, setType] = useState('PAYMENT');
  const [priority, setPriority] = useState('Normal');
  const [maxRetries, setMaxRetries] = useState(3);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.enqueueJob({ name, type, priority, maxRetries });
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
              <td>{job.lastFingerprint ? job.lastFingerprint.substring(0,8) : '-'}</td>
            </tr>
          ))}
          {jobs?.length === 0 && (
            <tr><td colSpan={8}>No jobs found.</td></tr>
          )}
        </tbody>
      </table>

      {selectedJob && <JobDrawer job={selectedJob} onClose={() => setSelectedJob(null)} />}
    </div>
  );
}

// --- Overview Tab ---
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
        <div className="stat-tile">
          <div className="stat-title">Retries Saved</div>
          <div className="stat-value">{stats?.attemptsSaved || 0}</div>
        </div>
      </div>

      <div className="circuit-strip">
        <span style={{color: '#aaa', alignSelf: 'center', marginRight: '1rem', textTransform: 'uppercase', fontSize: '0.875rem'}}>Dependency Status</span>
        {['payment-gateway', 'email-provider', 'auth-service', 'db-cluster', 'none'].map(dep => {
          const isDown = simState?.outages?.find(o => o.dependency === dep)?.isDown;
          // As a proxy for Open/Closed, if it's down we say OPEN
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
          <div className={`connection-indicator ${apiReachable ? '' : 'error'}`} title={apiReachable ? 'API Connected' : 'API Unreachable'} />
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
        {['Dead Letter', 'Incidents', 'Timeline', 'Simulator'].includes(activeTab) && (
          <div>
            <h2>{activeTab}</h2>
            <p>coming in part 7</p>
          </div>
        )}
      </div>
    </div>
  );
}
