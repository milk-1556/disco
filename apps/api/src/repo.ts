import { extractBrandTokens, makeSampleSnapshot } from '@disco/core';
import type { Client, Job, SnapshotRecord } from '@disco/schema';

/**
 * Persistence abstraction (async — Prisma-ready). The default is an in-memory store seeded with a
 * sample snapshot + client so the dashboard is useful on first boot with zero setup. The
 * Prisma-backed implementation (prismaRepo.ts) drops in behind this same interface for production,
 * selected by DATABASE_URL.
 */
export interface Repo {
  listSnapshots(): Promise<SnapshotRecord[]>;
  getSnapshot(id: string): Promise<SnapshotRecord | undefined>;
  addSnapshot(rec: Omit<SnapshotRecord, 'id'>): Promise<SnapshotRecord>;
  listClients(): Promise<Client[]>;
  getClient(id: string): Promise<Client | undefined>;
  addClient(c: Omit<Client, 'id' | 'createdAt'>): Promise<Client>;
  listJobs(): Promise<Job[]>;
  getJob(id: string): Promise<Job | undefined>;
  addJob(j: Omit<Job, 'id' | 'createdAt' | 'updatedAt'>): Promise<Job>;
  updateJob(id: string, patch: Partial<Job>): Promise<Job | undefined>;
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
  async addSnapshot(rec: Omit<SnapshotRecord, 'id'>) {
    const full: SnapshotRecord = { ...rec, id: newId('snap') };
    this.snapshots.set(full.id, full);
    return full;
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
}
