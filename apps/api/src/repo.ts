import { extractBrandTokens, makeSampleSnapshot } from '@disco/core';
import type { Client, Handover, Job, SnapshotMetaPatch, SnapshotRecord } from '@disco/schema';

/** Fields supplied when capturing/importing a snapshot — metadata (tags/note/…) defaults on insert. */
export type SnapshotCreate = Omit<SnapshotRecord, 'id' | 'tags' | 'note' | 'favorite' | 'isTemplate' | 'lastUsedAt'>;

/** Creation/patch shapes for handovers (passwordHash is write-only; never on the domain type). */
export interface HandoverCreate {
  jobId: string;
  clientId: string | null;
  state: Handover['state'];
  ownershipSteps: Handover['ownershipSteps'];
  upsellStatus: Handover['upsellStatus'];
  passwordHash?: string | null;
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
  getSnapshot(id: string): Promise<SnapshotRecord | undefined>;
  addSnapshot(rec: SnapshotCreate): Promise<SnapshotRecord>;
  updateSnapshot(id: string, patch: SnapshotMetaPatch): Promise<SnapshotRecord | undefined>;
  listClients(): Promise<Client[]>;
  getClient(id: string): Promise<Client | undefined>;
  addClient(c: Omit<Client, 'id' | 'createdAt'>): Promise<Client>;
  listJobs(): Promise<Job[]>;
  getJob(id: string): Promise<Job | undefined>;
  addJob(j: Omit<Job, 'id' | 'createdAt' | 'updatedAt'>): Promise<Job>;
  updateJob(id: string, patch: Partial<Job>): Promise<Job | undefined>;
  getHandover(id: string): Promise<Handover | undefined>;
  getHandoverByJob(jobId: string): Promise<Handover | undefined>;
  addHandover(h: HandoverCreate): Promise<Handover>;
  updateHandover(id: string, patch: HandoverPatch): Promise<Handover | undefined>;
  /** The stored password hash for a handover, for public-link verification (never on the domain type). */
  getHandoverPasswordHash(id: string): Promise<string | null | undefined>;
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
      createdAt: now(),
    };
    this.clients.set(client.id, client);
  }

  async listSnapshots() {
    return [...this.snapshots.values()].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
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

  async listClients() {
    return [...this.clients.values()];
  }
  async getClient(cid: string) {
    return this.clients.get(cid);
  }
  async addClient(c: Omit<Client, 'id' | 'createdAt'>) {
    const full: Client = { ...c, id: newId('client'), createdAt: now() };
    this.clients.set(full.id, full);
    return full;
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
}
