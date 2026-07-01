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
  config: () =>
    req<{
      mode: string;
      applicationId: string | null;
      // present only when authenticated (operator identity + deployment internals)
      operatorEmail?: string;
      hasToken?: boolean;
      storageDriver?: string;
      persistence?: string;
      queue?: string;
    }>('/config'),
  login: (email: string, password: string) =>
    req<{ token: string; email: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  snapshots: () => req<SnapshotSummary[]>('/snapshots'),
  snapshot: (id: string) => req<SnapshotRecord>(`/snapshots/${id}`),
  capture: (body: { sourceGuildId?: string; name?: string }) =>
    req<{ id: string; name: string; version: number; unchanged?: boolean }>('/snapshots/capture', { method: 'POST', body: JSON.stringify(body) }),
  guilds: () => req<{ live: boolean; guilds: JoinedGuild[] }>('/guilds'),
  updateSnapshot: (id: string, patch: SnapshotMetaPatch) =>
    req<{ id: string; favorite: boolean; isTemplate: boolean }>(`/snapshots/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteSnapshot: (id: string) => req<{ ok: boolean }>(`/snapshots/${id}`, { method: 'DELETE' }),
  status: () => req<StatusInfo>('/health'),
  audit: () => req<AuditEntry[]>('/audit'),
  buildEvents: (jobId?: string) => req<BuildEventEntry[]>(`/events${jobId ? `?jobId=${encodeURIComponent(jobId)}` : ''}`),
  dashboard: () => req<DashboardStats>('/dashboard'),
  onboarding: () => req<OnboardingState>('/onboarding'),
  surveys: () => req<SurveyAggregate>('/surveys'),
  earnings: () => req<Earnings>('/earnings'),
  setBilling: (jobId: string, billing: { invoicedCents?: number; paidCents?: number }) =>
    req<{ id: string; invoicedCents: number; paidCents: number }>(`/jobs/${jobId}/billing`, { method: 'PATCH', body: JSON.stringify(billing) }),
  // Public, one-time client survey submit from the delivery page (no auth — the handover id is the
  // capability). Returns whether it actually succeeded so the page only shows the thank-you on a real send.
  submitSurvey: async (id: string, nps: number, comment: string): Promise<boolean> => {
    try {
      const res = await fetch(`${BASE}/h/${id}/survey`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nps, comment }) });
      return res.ok;
    } catch {
      return false;
    }
  },
  mergePreview: (aId: string, bId: string) =>
    req<{ conflicts: MergeConflict[]; counts: Record<string, number> }>('/snapshots/merge/preview', { method: 'POST', body: JSON.stringify({ aId, bId }) }),
  mergeSnapshots: (aId: string, bId: string, resolutions: Record<string, 'a' | 'b'>, name?: string) =>
    req<{ id: string; name: string; version: number }>('/snapshots/merge', { method: 'POST', body: JSON.stringify({ aId, bId, resolutions, name }) }),
  marketplace: () => req<MarketplaceItem[]>('/marketplace'),
  cloneMarketplace: (templateId: string) => req<{ id: string; name: string; version: number }>(`/marketplace/${templateId}/clone`, { method: 'POST' }),
  readiness: (snapshotId: string, config: RebrandConfig, targetTier = 0) =>
    req<ReadinessReport>('/builds/readiness', { method: 'POST', body: JSON.stringify({ snapshotId, config, targetTier }) }),
  starterPacks: () => req<StarterPack[]>('/starter-packs'),
  importStarterPack: (key: string) => req<{ id: string; name: string; version: number }>(`/starter-packs/${encodeURIComponent(key)}/import`, { method: 'POST' }),
  handoverViews: (id: string) => req<{ count: number; recent: HandoverViewEntry[] }>(`/handovers/${id}/views`),
  rebrandPreview: (snapshotId: string, config: RebrandConfig) =>
    req<{ preview: RebrandPreview; rebrandedGuildName: string; brandTokens: BrandToken[] }>('/rebrand/preview', {
      method: 'POST',
      body: JSON.stringify({ snapshotId, config }),
    }),
  startJob: (body: { snapshotId: string; clientId?: string; config: RebrandConfig; dryRun: boolean; canary?: boolean; targetGuildId?: string }) =>
    req<{ id: string; status: string }>('/jobs', { method: 'POST', body: JSON.stringify(body) }),
  jobs: () => req<JobSummary[]>('/jobs'),
  job: (id: string) => req<Job>(`/jobs/${id}`),
  retryJob: (id: string) => req<{ id: string; status: string }>(`/jobs/${id}/retry`, { method: 'POST' }),
  cancelJob: (id: string) => req<{ id: string; status: string }>(`/jobs/${id}/cancel`, { method: 'POST' }),
  // #3 build replay: re-run a build's snapshot+config against a NEW target guild.
  replayJob: (id: string, body: { targetGuildId?: string; dryRun?: boolean; canary?: boolean }) =>
    req<{ id: string; status: string; replayOf: string }>(`/jobs/${id}/replay`, { method: 'POST', body: JSON.stringify(body) }),
  // #2 guild scan: read-only preview of what a white-label import would pull (no persist).
  scanGuild: (sourceGuildId?: string) =>
    req<ScanPreview>('/snapshots/scan', { method: 'POST', body: JSON.stringify({ sourceGuildId }) }),
  // #4 operator preferences / defaults.
  prefs: () => req<OperatorPrefs>('/operator/prefs'),
  setPrefs: (patch: Partial<OperatorPrefs>) => req<OperatorPrefs>('/operator/prefs', { method: 'PATCH', body: JSON.stringify(patch) }),
  // #6 webhook event log (admin only).
  webhookEvents: (source?: 'stripe' | 'discord', limit = 200) =>
    req<WebhookEvent[]>(`/admin/webhooks?limit=${limit}${source ? `&source=${source}` : ''}`),
  // Trust lane #3: per-build trace — per-step timing + retry count + outcomes.
  buildTrace: (jobId: string) => req<BuildTrace>(`/builds/${jobId}/trace`),
  clients: () => req<Client[]>('/clients'),
  addClient: (body: Partial<Client>) => req<Client>('/clients', { method: 'POST', body: JSON.stringify(body) }),
  deleteClient: (id: string) => req<{ ok: boolean }>(`/clients/${id}`, { method: 'DELETE' }),
  inviteUrl: (applicationId: string, mode: 'administrator' | 'granular', guildId?: string) =>
    req<{ url: string; permissions: string; mode: string }>(
      `/invite-url?applicationId=${encodeURIComponent(applicationId)}&mode=${mode}${guildId ? `&guildId=${guildId}` : ''}`,
    ),
  preflight: (guildId: string) =>
    req<{ guildId: string; mode: string; ok: boolean; hasAdmin: boolean; missing: { name: string; why: string }[]; permissions: string }>(
      `/preflight/${encodeURIComponent(guildId)}`,
    ),
  diff: (id: string, against: string) =>
    req<SnapshotDiff>(`/snapshots/${id}/diff?against=${encodeURIComponent(against)}`),
  feasibility: (id: string, targetTier = 0) =>
    req<{ ok: boolean; targetTier: number; findings: { name: string; detail: string; severity: 'block' | 'warn' }[] }>(
      `/snapshots/${id}/feasibility?targetTier=${targetTier}`,
    ),
  exportBundle: (id: string) => req<Record<string, unknown>>(`/snapshots/${id}/export`),
  importBundle: (bundle: unknown) =>
    req<{ id: string; name: string; version: number }>('/bundles/import', { method: 'POST', body: JSON.stringify(bundle) }),
  createHandover: (jobId: string) => req<Handover>('/handovers', { method: 'POST', body: JSON.stringify({ jobId }) }),
  getHandover: (id: string) => req<HandoverBundle>(`/handovers/${id}`),
  updateHandover: (
    id: string,
    patch: Partial<Pick<Handover, 'state' | 'ownershipSteps' | 'upsellStatus' | 'welcomeMessage' | 'inviteUrl'>> & { password?: string | null; logo?: string | null },
  ) => req<Handover>(`/handovers/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  /** Public (unauthenticated) delivery page fetch — password via query when gated. */
  publicHandover: async (id: string, pw?: string): Promise<PublicHandover> => {
    const res = await fetch(`${BASE}/h/${id}${pw ? `?pw=${encodeURIComponent(pw)}` : ''}`);
    if (res.status === 401) throw new Error('PASSWORD_REQUIRED');
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `${res.status}`);
    return res.json() as Promise<PublicHandover>;
  },
  // Operator-side handover engagement analytics (#4).
  handoverAnalytics: (id: string) => req<HandoverAnalytics>(`/handovers/${id}/analytics`),
  // Public, fire-and-forget engagement beacon from the delivery page (no auth — the id is the capability).
  trackHandoverEvent: (id: string, kind: 'report_downloaded' | 'docs_viewed') => {
    void fetch(`${BASE}/h/${id}/event`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind }) }).catch(() => {});
  },
};

/** Absolute URL for an API-served asset path (e.g. a handover logo "/assets/...."). */
export const assetUrl = (path: string) => `${BASE}${path}`;

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

/** SSE of activity pings (build finished, server imported, handover created, client added). Calls
 *  onPing on each event so the caller can refetch instantly. Returns an unsubscribe fn. */
export function streamActivity(onPing: () => void): () => void {
  const ctrl = new AbortController();
  fetch(`${BASE}/activity/stream`, { headers: token ? { authorization: `Bearer ${token}` } : {}, signal: ctrl.signal })
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
          if (line && (line.includes('"ping"') || line.includes('"open"'))) onPing();
        }
      }
    })
    .catch(() => {});
  return () => ctrl.abort();
}

// ── shared types (mirror @disco/schema shapes the UI consumes) ──
export interface AuditEntry {
  id: string;
  at: string;
  action: string;
  target: string;
  detail: string;
  operator: string;
}
export interface StatusInfo {
  ok: boolean;
  mode: string;
  api: 'up';
  worker: 'up' | 'down' | 'n/a';
  queue: string;
  persistence: string;
  uptimeSec: number;
  lastBuildAt: string | null;
  lastActivityAt: string | null;
  requests: { total: number; errorRate: number; p50Ms: number; p95Ms: number; perRoute: { route: string; count: number; p95Ms: number; errorRate: number }[] };
}
export interface JoinedGuild {
  id: string;
  name: string;
  iconUrl: string | null;
  owner: boolean;
  canManage: boolean;
}
export interface SnapshotSummary {
  id: string;
  name: string;
  version: number;
  sourceGuildId: string;
  capturedAt: string;
  tags: string[];
  note: string;
  favorite: boolean;
  isTemplate: boolean;
  shared: boolean;
  lastUsedAt: string | null;
  counts: Record<string, number>;
}
export interface MergeConflict {
  kind: string;
  name: string;
}
export interface MarketplaceItem {
  templateId: string;
  name: string;
  sourceOperator: string;
  version: number;
  mine: boolean;
  counts: { roles: number; channels: number; categories: number; emojis: number; automod: number };
  categories: string[];
  sampleChannels: string[];
  roles: string[];
}
export interface SnapshotMetaPatch {
  name?: string;
  tags?: string[];
  note?: string;
  favorite?: boolean;
  isTemplate?: boolean;
  shared?: boolean;
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
export interface StepState {
  step: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  startedAt: string | null;
  finishedAt: string | null;
  /** How many times the engine entered this step; >1 means a prior attempt failed here and it resumed. */
  attempts?: number;
}
export interface JobManifest {
  steps: StepState[];
  entries: { localRef: string; kind: string; newId: string | null; status: string }[];
}
export interface JobMetrics {
  apiCalls: number;
  durationMs: number;
  objectsCreated: number;
}
export interface Job {
  id: string;
  kind: string;
  status: string;
  dryRun: boolean;
  progress: number;
  manifest: JobManifest | null;
  metrics: JobMetrics | null;
  report: RebuildReport | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface JobSummary {
  id: string;
  kind: string;
  status: string;
  dryRun: boolean;
  canary: boolean;
  progress: number;
  snapshotId: string | null;
  snapshotName: string | null;
  clientId: string | null;
  clientName: string | null;
  error: string | null;
  metrics: JobMetrics | null;
  invoicedCents: number;
  paidCents: number;
  createdAt: string;
  updatedAt: string;
}
export interface Upsell {
  name: string;
  price: number;
}
export interface Client {
  id: string;
  creatorName: string;
  handle: string;
  brandColors: string[];
  links: string[];
  notes: string;
  buildPrice: number;
  monthlyRetainer: number;
  upsells: Upsell[];
  createdAt: string;
}
export interface JobEvent {
  type: 'log' | 'progress' | 'done' | 'error';
  message?: string;
  progress?: number;
  step?: string;
}
export interface FieldChange {
  field: string;
  before: string;
  after: string;
}
export interface BuildEventEntry {
  id: string;
  jobId: string;
  at: string;
  kind: string;
  detail: string;
}
export interface ReadinessReport {
  verdict: 'ready' | 'ready_with_warnings' | 'blocked';
  serverName: string;
  targetTier: number;
  wouldCreate: number;
  wouldSkip: number;
  manualSteps: number;
  counts: Record<string, number>;
  blocks: { name: string; detail: string; severity: string }[];
  warnings: { name: string; detail: string; severity: string }[];
  skipped: { ref: string; reason: string }[];
  steps: string[];
}
export interface OnboardingState {
  liveMode: boolean;
  hasToken: boolean;
  hasTemplate: boolean;
  ranValidation: boolean;
  ranCanary: boolean;
  ranRealBuild: boolean;
  deliveredHandover: boolean;
  counts: { templates: number; builds: number; handovers: number };
}
export interface DashboardStats {
  buildsThisWeek: number;
  avgBuildMs: number;
  stuckHandovers: number;
  totalClients: number;
  retainedClients: number;
  clientRetentionRate: number;
  slowBuilds: number;
  slowestBuildMs: number;
  sloMs: number;
  today: { builds: number; delivered: number; snapshots: number; clientOpens: number };
}
export interface StarterPack {
  key: string;
  title: string;
  pitch: string;
  niche: string;
  guildName: string;
  counts: { roles: number; channels: number; categories: number; emojis: number };
  categories: string[];
  sampleChannels: string[];
  roles: string[];
}
export interface HandoverViewEntry {
  id: string;
  handoverId: string;
  at: string;
  referrer: string;
  kind: string;
}
export interface HandoverAnalytics {
  total: number;
  opened: number;
  reportDownloaded: number;
  docsViewed: number;
  shareViewed: number;
  firstOpenedAt: string | null;
  lastSeenAt: string | null;
  deliveredAt: string | null;
  timeToFirstOpenMs: number | null;
  firstWeekOpens: number;
  classification: 'warm' | 'cool' | 'cold';
  decay: { day: number; opens: number }[];
  timeline: { at: string; kind: string; referrer: string }[];
}
export interface SurveyAggregate {
  count: number;
  avgNps: number | null;
  npsScore: number | null;
  promoters: number;
  detractors: number;
  responses: { handoverId: string; nps: number | null; comment: string; at: string | null }[];
}
export interface Earnings {
  invoicedCents: number;
  paidCents: number;
  outstandingCents: number;
  ytdPaidCents: number;
  mrrCents: number;
  billedBuilds: number;
  totalBuilds: number;
  perTemplate: { name: string; paidCents: number; builds: number }[];
}
export interface PermissionDelta {
  added: string[];
  removed: string[];
}
export interface CategoryDiff {
  added: string[];
  removed: string[];
  changed: { name: string; fields: FieldChange[]; permissionDelta?: PermissionDelta }[];
}
export interface OverwriteChange {
  container: string;
  target: string;
  allow: PermissionDelta;
  deny: PermissionDelta;
}
export interface SnapshotDiff {
  guildNameChanged: { before: string; after: string } | null;
  roles: CategoryDiff;
  channels: CategoryDiff;
  categories: CategoryDiff;
  emojis: CategoryDiff;
  automod: CategoryDiff;
  overwriteChanges: OverwriteChange[];
  counts: Record<string, { before: number; after: number }>;
}
export interface OwnershipStep {
  title: string;
  detail: string;
  done: boolean;
}
// #2 read-only guild scan preview (not persisted).
export interface ScanPreview {
  live: boolean;
  sourceGuildId: string;
  guildName: string;
  counts: { roles: number; channels: number; categories: number; emojis: number; stickers: number; automod: number; bots: number };
  headsUp: string[];
}
// #4 per-operator defaults.
export interface OperatorPrefs {
  operatorEmail: string;
  defaultCanary: boolean;
  defaultDryRun: boolean;
  defaultWelcomeMessage: string;
  defaultOwnershipSteps: OwnershipStep[] | null;
  updatedAt: string | null;
}
// Trust lane #3: a synthesized per-build trace.
export interface BuildTrace {
  jobId: string;
  status: string;
  dryRun: boolean;
  targetGuildId: string | null;
  metrics: { apiCalls: number; durationMs: number; objectsCreated: number } | null;
  resumes: number;
  retriedSteps: string[];
  steps: {
    step: string;
    status: string;
    attempts: number;
    startedAt: string | null;
    finishedAt: string | null;
    durationMs: number | null;
    objects: { created: number; updated: number; skipped: number; failed: number };
  }[];
  events: { at: string; kind: string; detail: string }[];
}
// #6 inbound webhook receipt (admin log).
export interface WebhookEvent {
  id: string;
  at: string;
  source: string;
  eventId: string;
  eventType: string;
  signatureValid: boolean;
  outcome: string;
  detail: string;
}
export interface Handover {
  id: string;
  jobId: string;
  clientId: string | null;
  state: 'draft' | 'ready' | 'handed_over';
  hasPassword: boolean;
  logoKey: string | null;
  welcomeMessage: string;
  inviteUrl: string;
  ownershipSteps: OwnershipStep[];
  upsellStatus: 'none' | 'proposed' | 'retained' | 'redesign';
  createdAt: string;
}
export interface PublicHandover {
  serverName: string | null;
  sourceName: string | null;
  state: string;
  logoUrl: string | null;
  welcomeMessage: string;
  inviteUrl: string;
  scope: Record<string, number>;
  created: string[];
  botChecklist: string[];
  botSetup: BotSetupEntry[];
  manualSteps: ManualStep[];
  ownershipSteps: OwnershipStep[];
  surveyDone: boolean;
}
export interface HandoverBundle {
  handover: Handover;
  job: Job | null;
}
