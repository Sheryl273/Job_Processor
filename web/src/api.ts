export type JobStatus = 'Queued' | 'Processing' | 'Retrying' | 'Held' | 'Succeeded' | 'Dead';
export type Priority = 'High' | 'Normal' | 'Low';

export interface Job {
  id: string;
  name: string;
  type: string;
  priority: Priority;
  status: JobStatus;
  maxRetries: number;
  attempts: number;
  dependency: string;
  nextRunAt: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  leaseExpiresAt: string | null;
  heldAt: string | null;
  lastFingerprint: string | null;
  reclaimCount: number;
}

export interface Stats {
  total: number;
  queued: number;
  processing: number;
  retrying: number;
  held: number;
  succeeded: number;
  dead: number;
  failedAttempts: number;
  attemptsSaved: number;
}

export interface CircuitCard {
  dependency: string;
  state: string; // 'Closed' | 'Open' | 'Half-Open'
  failureCount: number;
  incidentOpenedTime: string | null;
  jobsHeld: number;
  attemptsSaved: number;
}

export interface BlastRadiusItem {
  dependency: string;
  circuitState: string;
  jobTypes: string[];
  held: number;
  queued: number;
  retrying: number;
  dead: number;
  succeeded: number;
  totalAffected: number;
  attemptsSavedTotal: number;
}

export interface FailureGroup {
  fingerprint: string;
  title: string;
  sampleMessage: string;
  dependency: string;
  failureCount: number;
  affectedJobs: number;
  affectedJobTypes: string[];
  firstSeen: string;
  lastSeen: string;
  deadCount: number;
}

export interface DeadLetter {
  id: number;
  jobId: string;
  jobName: string;
  jobType: string;
  attempts: number;
  finalError: string;
  fingerprint: string;
  failedAt: string;
  replayedAt: string | null;
}

export interface JobFailure {
  id: string;
  jobId: string;
  at: string;
  attempt: number;
  exceptionType: string;
  message: string;
  stackTrace: string;
  fingerprint: string;
}

export interface EventLog {
  id: string;
  at: string;
  type: string;
  jobId: string | null;
  dependency: string | null;
  message: string;
}

export interface SimState {
  outages: { dependency: string; isDown: boolean; endsAt: string | null }[];
  workers: { id: string; state: string; currentJobId: string | null }[];
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API Error ${res.status}: ${text}`);
  }
  if (res.status === 204) {
    return {} as T;
  }
  return (await res.json()) as T;
}

export const api = {
  getStats: () => request<Stats>('/api/stats'),
  getJobs: (status?: string) => request<Job[]>(status ? `/api/jobs?status=${status}` : '/api/jobs'),
  getJob: (id: string) => request<{ job: Job; failures: JobFailure[]; events: EventLog[] }>(`/api/jobs/${id}`),
  getJobFailures: (id: string) => request<JobFailure[]>(`/api/jobs/${id}/failures`),
  getJobEvents: (id: string) => request<EventLog[]>(`/api/jobs/${id}/events`),
  enqueueJob: (payload: any) =>
    request<Job>('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  getCircuits: () => request<CircuitCard[]>('/api/circuits'),
  getBlastRadius: () => request<BlastRadiusItem[]>('/api/blast-radius'),
  getFailureGroups: () => request<FailureGroup[]>('/api/failure-groups'),
  getDeadLetters: () => request<DeadLetter[]>('/api/jobs/dead-letter'),
  replayDeadLetter: (id: number | string) =>
    request<{ message: string }>(`/api/dead-letter/${id}/replay`, {
      method: 'POST',
    }),
  replayGroup: (fingerprint: string) =>
    request<{ replayed: number }>('/api/dead-letter/replay-group', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fingerprint }),
    }),
  getTimeline: (take: number = 150) => request<EventLog[]>(`/api/timeline?take=${take}`),

  // Simulator endpoints
  simEnqueue: (payload: any) =>
    request<{ enqueued: number }>('/api/sim/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  simOutage: (payload: any) =>
    request<any>('/api/sim/outage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  simState: () => request<SimState>('/api/sim/state'),
  simKillWorker: (workerId?: string) =>
    request<any>('/api/sim/kill-worker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workerId }),
    }),
  simReset: () =>
    request<any>('/api/sim/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }),
};

