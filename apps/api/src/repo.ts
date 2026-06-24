import { extractBrandTokens, makeSampleSnapshot } from '@disco/core';
import type { Client, Handover, Job, SnapshotMetaPatch, SnapshotRecord } from '@disco/schema';

/** Fields supplied when capturing/importing a snapshot — metadata (tags/note/…) defaults on insert. */
export type SnapshotCreate = Omit<SnapshotRecord, 'id' | 'tags' | 'note' | 'favorite' | 'isTemplate' | 'lastUsedAt'>;

/** One accountability record for a destructive operation. */
export interface AuditEntry {
  id: string;
  at: string;
  action: string;
  target: string;
  detail: string;
  operator: string;
}

/** A build-lifecycle event (the operator-facing "webhook event log": started / done / failed / resumed). */
export interface BuildEventEntry {
  id: string;
  jobId: string;
  at: string;
  kind: string; // queued | running | completed | failed | resumed | delivered
  detail: string;
  ownerEmail: string; // multi-operator scoping (copied from the owning job)
}

/** One anonymous open of a public handover page. We store the referrer ORIGIN only — never an IP or
 *  any other identifier — so the operator gets an engagement signal without compiling personal data. */
export interface HandoverViewEntry {
  id: string;
  handoverId: string;
  at: string;
  referrer: string;
}

/** Creation/patch shapes for handovers (passwordHash is write-only; never on the domain type). */
export interface HandoverCreate {
  jobId: string;
  clientId: string | null;
  state: Handover['state'];
  ownershipSteps: Handover['ownershipSteps'];
  upsellStatus: Handover['upsellStatus'];
  passwordHash?: string | null;
  ownerEmail: string;
}
export type HandoverPatch = Partial<{
  state: Handover['state'];
  ownershipSteps: Handover['ownershipSteps'];
  upsellStatus: Handover['upsellStatus'];
  passwordHash: string | null;
  logoKey: string | null;
  welcomeMessage: string;
}>;

/**
 * Persistence abstraction (async — Prisma-ready). The default is an in-memory store seeded with a
 * sample snapshot + client so the dashboard is useful on first boot with zero setup. The
 * Prisma-backed implementation (prismaRepo.ts) drops in behind this same interface for production,
 * selected by DATABASE_URL.
 */
export interface Repo {
  listSnapshots(): Promise<SnapshotRecord[]>;
  /** Cheap id→name lookup (no artifact-blob parse) — for joining names onto the polled /jobs list. */
  snapshotNames(): Promise<{ id: string; name: string; ownerEmail: string }[]>;
  getSnapshot(id: string): Promise<SnapshotRecord | undefined>;
  addSnapshot(rec: SnapshotCreate): Promise<SnapshotRecord>;
  updateSnapshot(id: string, patch: SnapshotMetaPatch): Promise<SnapshotRecord | undefined>;
  deleteSnapshot(id: string): Promise<void>;
  listClients(): Promise<Client[]>;
  getClient(id: string): Promise<Client | undefined>;
  addClient(c: Omit<Client, 'id' | 'createdAt'>): Promise<Client>;
  /** Indexed lookup for idempotent Stripe webhook fulfilment (replaces an O(n) notes scan). */
  clientByStripeSession(sessionId: string): Promise<Client | undefined>;
  deleteClient(id: string): Promise<void>;
  listJobs(): Promise<Job[]>;
  getJob(id: string): Promise<Job | undefined>;
  addJob(j: Omit<Job, 'id' | 'createdAt' | 'updatedAt'>): Promise<Job>;
  updateJob(id: string, patch: Partial<Job>): Promise<Job | undefined>;
  getHandover(id: string): Promise<Handover | undefined>;
  getHandoverByJob(jobId: string): Promise<Handover | undefined>;
  /** All handovers (for the operator dashboard's stuck-handover widget); scoped by the wrapper. */
  listHandovers(): Promise<Handover[]>;
  addHandover(h: HandoverCreate): Promise<Handover>;
  updateHandover(id: string, patch: HandoverPatch): Promise<Handover | undefined>;
  /** The stored password hash for a handover, for public-link verification (never on the domain type). */
  getHandoverPasswordHash(id: string): Promise<string | null | undefined>;
  /** Append a destructive-op accountability record; list the most recent first. */
  addAudit(e: Omit<AuditEntry, 'id' | 'at'>): Promise<void>;
  listAudit(limit?: number): Promise<AuditEntry[]>;
  /** Build-lifecycle event log (#12). `listBuildEvents()` is global; pass a jobId to scope to one build. */
  addBuildEvent(e: Omit<BuildEventEntry, 'id' | 'at'>): Promise<void>;
  listBuildEvents(jobId?: string, limit?: number): Promise<BuildEventEntry[]>;
  /** Record + read anonymous public-handover opens (#14 engagement signal; referrer-origin only). */
  recordHandoverView(handoverId: string, referrer: string): Promise<void>;
  listHandoverViews(handoverId: string): Promise<HandoverViewEntry[]>;
}

let seq = 1;
export const newId = (p: string) => `${p}_${(seq++).toString(36)}${Date.now().toString(36)}`;
const now = () => new Date().toISOString();

export class InMemoryRepo implements Repo {
  private snapshots = new Map<string, SnapshotRecord>();
  private clients = new Map<string, Client>();
  private jobs = new Map<string, Job>();

  constructor(seed = true) {
    if (seed) this.seed();
  }

  private seed() {
    const snap = makeSampleSnapshot();
    snap.brandTokens = extractBrandTokens(snap);
    const rec: SnapshotRecord = {
      id: 'snap_sample',
      name: 'Acme Slots HQ (sample template)',
      version: 1,
      sourceGuildId: snap.source.guildId,
      capturedAt: snap.capturedAt,
      schemaVersion: snap.schemaVersion,
      snapshot: snap,
      tags: ['gambling', 'slots'],
      note: 'Master template — polished slots community.',
      favorite: true,
      isTemplate: true,
      lastUsedAt: null,
      ownerEmail: '', // system/unowned — the sole operator is admin and sees it via bypass
    };
    this.snapshots.set(rec.id, rec);
    const client: Client = {
      id: 'client_nova',
      creatorName: 'Nova',
      handle: '@novaplays',
      brandColors: ['#E11D48'],
      links: ['https://whop.com/nova-vip'],
      assets: {},
      termSwaps: [{ from: 'Acme', to: 'Nova' }],
      notes: 'Sample client for the Nova rebrand.',
      buildPrice: 3500,
      monthlyRetainer: 500,
      upsells: [],
      ownerEmail: '', // system/unowned — admin-visible via bypass
      createdAt: now(),
    };
    this.clients.set(client.id, client);
  }

  async listSnapshots() {
    return [...this.snapshots.values()].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  }
  async snapshotNames() {
    return [...this.snapshots.values()].map((s) => ({ id: s.id, name: s.name, ownerEmail: s.ownerEmail }));
  }
  async getSnapshot(sid: string) {
    return this.snapshots.get(sid);
  }
  async addSnapshot(rec: SnapshotCreate) {
    const full: SnapshotRecord = { ...rec, id: newId('snap'), tags: [], note: '', favorite: false, isTemplate: false, lastUsedAt: null };
    this.snapshots.set(full.id, full);
    return full;
  }
  async updateSnapshot(sid: string, patch: SnapshotMetaPatch) {
    const s = this.snapshots.get(sid);
    if (!s) return undefined;
    const next = { ...s, ...patch };
    this.snapshots.set(sid, next);
    return next;
  }
  async deleteSnapshot(sid: string) {
    this.snapshots.delete(sid);
    for (const j of this.jobs.values()) if (j.snapshotId === sid) j.snapshotId = null; // unlink, keep build records
  }

  async listClients() {
    return [...this.clients.values()];
  }
  async getClient(cid: string) {
    return this.clients.get(cid);
  }
  async addClient(c: Omit<Client, 'id' | 'createdAt'>) {
    // Mirror the Prisma @unique(stripeSessionId) atomically: a synchronous duplicate check (Node is
    // single-threaded, so this closes the await-interleaved race) makes Stripe fulfilment exactly-once
    // on the in-memory backend too — the webhook's catch then dedups instead of double-creating.
    if (c.stripeSessionId) {
      for (const existing of this.clients.values()) {
        if (existing.stripeSessionId === c.stripeSessionId) {
          throw new Error(`duplicate stripeSessionId: ${c.stripeSessionId}`);
        }
      }
    }
    const full: Client = { ...c, id: newId('client'), createdAt: now() };
    this.clients.set(full.id, full);
    return full;
  }
  async clientByStripeSession(sessionId: string) {
    return [...this.clients.values()].find((c) => c.stripeSessionId === sessionId);
  }
  async deleteClient(id: string) {
    this.clients.delete(id);
    // unlink from builds AND handovers (matching PrismaRepo) so no record dangles on the removed client
    for (const j of this.jobs.values()) if (j.clientId === id) j.clientId = null;
    for (const h of this.handovers.values()) if (h.clientId === id) h.clientId = null;
  }

  async listJobs() {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async getJob(jid: string) {
    return this.jobs.get(jid);
  }
  async addJob(j: Omit<Job, 'id' | 'createdAt' | 'updatedAt'>) {
    const full: Job = { ...j, id: newId('job'), createdAt: now(), updatedAt: now() };
    this.jobs.set(full.id, full);
    return full;
  }
  async updateJob(jid: string, patch: Partial<Job>) {
    const j = this.jobs.get(jid);
    if (!j) return undefined;
    const next = { ...j, ...patch, updatedAt: now() };
    this.jobs.set(jid, next);
    return next;
  }

  private handovers = new Map<string, Handover & { passwordHash: string | null }>();
  async getHandover(id: string) {
    const h = this.handovers.get(id);
    return h ? this.publicHandover(h) : undefined;
  }
  async getHandoverByJob(jobId: string) {
    const h = [...this.handovers.values()].find((x) => x.jobId === jobId);
    return h ? this.publicHandover(h) : undefined;
  }
  async listHandovers() {
    return [...this.handovers.values()].map((h) => this.publicHandover(h));
  }
  async addHandover(h: HandoverCreate) {
    const full: Handover & { passwordHash: string | null } = {
      id: newId('handover'),
      jobId: h.jobId,
      clientId: h.clientId,
      state: h.state,
      hasPassword: !!h.passwordHash,
      logoKey: null,
      welcomeMessage: '',
      ownershipSteps: h.ownershipSteps,
      upsellStatus: h.upsellStatus,
      ownerEmail: h.ownerEmail,
      createdAt: now(),
      passwordHash: h.passwordHash ?? null,
    };
    this.handovers.set(full.id, full);
    return this.publicHandover(full);
  }
  async updateHandover(id: string, patch: HandoverPatch) {
    const h = this.handovers.get(id);
    if (!h) return undefined;
    const next = {
      ...h,
      ...patch,
      passwordHash: patch.passwordHash !== undefined ? patch.passwordHash : h.passwordHash,
      hasPassword: patch.passwordHash !== undefined ? !!patch.passwordHash : h.hasPassword,
    };
    this.handovers.set(id, next);
    return this.publicHandover(next);
  }
  async getHandoverPasswordHash(id: string) {
    return this.handovers.get(id)?.passwordHash;
  }
  private publicHandover(h: Handover & { passwordHash: string | null }): Handover {
    const { passwordHash: _ph, ...rest } = h;
    return rest;
  }

  private audits: AuditEntry[] = [];
  async addAudit(e: Omit<AuditEntry, 'id' | 'at'>) {
    this.audits.push({ ...e, id: newId('audit'), at: now() });
    if (this.audits.length > 1000) this.audits.shift(); // bound demo memory
  }
  async listAudit(limit = 200) {
    return [...this.audits].reverse().slice(0, limit);
  }

  private buildEvents: BuildEventEntry[] = [];
  async addBuildEvent(e: Omit<BuildEventEntry, 'id' | 'at'>) {
    this.buildEvents.push({ ...e, id: newId('evt'), at: now() });
    if (this.buildEvents.length > 2000) this.buildEvents.shift();
  }
  async listBuildEvents(jobId?: string, limit = 200) {
    const all = jobId ? this.buildEvents.filter((e) => e.jobId === jobId) : this.buildEvents;
    return [...all].reverse().slice(0, limit);
  }

  private handoverViews: HandoverViewEntry[] = [];
  async recordHandoverView(handoverId: string, referrer: string) {
    this.handoverViews.push({ id: newId('view'), handoverId, at: now(), referrer });
    if (this.handoverViews.length > 5000) this.handoverViews.shift();
  }
  async listHandoverViews(handoverId: string) {
    return this.handoverViews.filter((v) => v.handoverId === handoverId).reverse();
  }
}
