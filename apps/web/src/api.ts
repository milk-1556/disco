// Default to the same-origin Vite proxy (/api) so there is no CORS and SSE streams cleanly.
// Set VITE_API_BASE to hit the API directly (e.g. in production behind one origin).
const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

let token: string | null = localStorage.getItem('disco_token');

export function getToken() {
  return token;
}
export function setToken(t: string | null) {
  token = t;
  if (t) localStorage.setItem('disco_token', t);
  else localStorage.removeItem('disco_token');
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  base: BASE,
  config: () => req<{ mode: string; applicationId: string | null; operatorEmail: string }>('/config'),
  login: (email: string, password: string) =>
    req<{ token: string; email: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  snapshots: () => req<SnapshotSummary[]>('/snapshots'),
  snapshot: (id: string) => req<SnapshotRecord>(`/snapshots/${id}`),
  capture: (body: { sourceGuildId?: string; name?: string }) =>
    req<{ id: string; name: string; version: number }>('/snapshots/capture', { method: 'POST', body: JSON.stringify(body) }),
  rebrandPreview: (snapshotId: string, config: RebrandConfig) =>
    req<{ preview: RebrandPreview; rebrandedGuildName: string; brandTokens: BrandToken[] }>('/rebrand/preview', {
      method: 'POST',
      body: JSON.stringify({ snapshotId, config }),
    }),
  startJob: (body: { snapshotId: string; clientId?: string; config: RebrandConfig; dryRun: boolean }) =>
    req<{ id: string; status: string }>('/jobs', { method: 'POST', body: JSON.stringify(body) }),
  jobs: () => req<JobSummary[]>('/jobs'),
  job: (id: string) => req<Job>(`/jobs/${id}`),
  retryJob: (id: string) => req<{ id: string; status: string }>(`/jobs/${id}/retry`, { method: 'POST' }),
  cancelJob: (id: string) => req<{ id: string; status: string }>(`/jobs/${id}/cancel`, { method: 'POST' }),
  clients: () => req<Client[]>('/clients'),
  addClient: (body: Partial<Client>) => req<Client>('/clients', { method: 'POST', body: JSON.stringify(body) }),
  inviteUrl: (applicationId: string, mode: 'administrator' | 'granular', guildId?: string) =>
    req<{ url: string; permissions: string; mode: string }>(
      `/invite-url?applicationId=${encodeURIComponent(applicationId)}&mode=${mode}${guildId ? `&guildId=${guildId}` : ''}`,
    ),
  diff: (id: string, against: string) =>
    req<SnapshotDiff>(`/snapshots/${id}/diff?against=${encodeURIComponent(against)}`),
  exportBundle: (id: string) => req<Record<string, unknown>>(`/snapshots/${id}/export`),
  importBundle: (bundle: unknown) =>
    req<{ id: string; name: string; version: number }>('/bundles/import', { method: 'POST', body: JSON.stringify(bundle) }),
  createHandover: (jobId: string) => req<Handover>('/handovers', { method: 'POST', body: JSON.stringify({ jobId }) }),
  getHandover: (id: string) => req<HandoverBundle>(`/handovers/${id}`),
  updateHandover: (id: string, patch: Partial<Pick<Handover, 'state' | 'ownershipSteps' | 'upsellStatus'>> & { password?: string | null }) =>
    req<Handover>(`/handovers/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
};

/** SSE stream of a job's logs; returns an unsubscribe fn. */
export function streamJobLogs(jobId: string, onEvent: (ev: JobEvent) => void): () => void {
  const url = `${BASE}/jobs/${jobId}/logs`;
  // EventSource can't send auth headers, so include the token as a query param fallback is not
  // implemented server-side; instead we poll the job + replay via fetch stream.
  const ctrl = new AbortController();
  fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {}, signal: ctrl.signal })
    .then(async (res) => {
      const reader = res.body?.getReader();
      if (!reader) return;
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const p of parts) {
          const line = p.replace(/^data: /, '').trim();
          if (line) {
            try {
              onEvent(JSON.parse(line) as JobEvent);
            } catch {
              /* ignore */
            }
          }
        }
      }
    })
    .catch(() => {});
  return () => ctrl.abort();
}

// ── shared types (mirror @disco/schema shapes the UI consumes) ──
export interface SnapshotSummary {
  id: string;
  name: string;
  version: number;
  sourceGuildId: string;
  capturedAt: string;
  counts: Record<string, number>;
}
export interface BrandToken {
  kind: 'name' | 'color' | 'url';
  value: string;
  occurrences: number;
  sources: string[];
}
export interface SnapshotRecord {
  id: string;
  name: string;
  version: number;
  snapshot: {
    guild: { name: string };
    roles: { name: string; colors: { primary: number }; managed: boolean }[];
    channels: { name: string; kind: string; copyPolicy: string }[];
    categories: { name: string }[];
    emojis: { name: string }[];
    bots: { name: string; vendorGuess: string | null }[];
    brandTokens: BrandToken[];
  };
}
export interface RebrandChange {
  path: string;
  field: string;
  before: string;
  after: string;
  rule: string;
}
export interface RebrandPreview {
  changes: RebrandChange[];
  unchangedTokens: string[];
}
export interface RebrandConfig {
  clientId: string;
  serverName?: string;
  findReplace: { from: string; to: string; caseInsensitive?: boolean; wholeWordSmart?: boolean }[];
  colorMap: { from: string; to: string }[];
  linkMap: { from: string; to: string }[];
  assets: Record<string, never>;
}
export interface ManualStep {
  title: string;
  reason: string;
  url: string | null;
  category: string;
}
export interface BotSetupEntry {
  name: string;
  vendor: string | null;
  oauthUrl: string | null;
  dashboardUrl: string | null;
  permissions: string;
  reconfigure: string[];
}
export interface RebuildReport {
  dryRun: boolean;
  created: string[];
  updated: string[];
  skipped: { ref: string; reason: string }[];
  manualSteps: ManualStep[];
  botChecklist: string[];
  botSetup: BotSetupEntry[];
  warnings: string[];
  counts: Record<string, number>;
}
export interface Job {
  id: string;
  kind: string;
  status: string;
  dryRun: boolean;
  progress: number;
  report: RebuildReport | null;
  error: string | null;
  createdAt: string;
}
export interface JobSummary {
  id: string;
  kind: string;
  status: string;
  dryRun: boolean;
  progress: number;
  snapshotId: string | null;
  clientId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface Client {
  id: string;
  creatorName: string;
  handle: string;
  brandColors: string[];
  links: string[];
  notes: string;
  createdAt: string;
}
export interface JobEvent {
  type: 'log' | 'progress' | 'done' | 'error';
  message?: string;
  progress?: number;
  step?: string;
}
export interface SnapshotDiff {
  guildNameChanged: { before: string; after: string } | null;
  roles: { added: string[]; removed: string[] };
  channels: { added: string[]; removed: string[] };
  emojis: { added: string[]; removed: string[] };
  counts: Record<string, { before: number; after: number }>;
}
export interface OwnershipStep {
  title: string;
  detail: string;
  done: boolean;
}
export interface Handover {
  id: string;
  jobId: string;
  clientId: string | null;
  state: 'draft' | 'ready' | 'handed_over';
  hasPassword: boolean;
  ownershipSteps: OwnershipStep[];
  upsellStatus: 'none' | 'proposed' | 'retained' | 'redesign';
  createdAt: string;
}
export interface HandoverBundle {
  handover: Handover;
  job: Job | null;
}
