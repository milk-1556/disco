import { extractBrandTokens, makeSampleSnapshot } from '@disco/core';
import type { Client, Job, SnapshotRecord } from '@disco/schema';

/**
 * Persistence abstraction. The default is an in-memory store seeded with a sample snapshot + client
 * so the dashboard is useful on first boot with zero setup. A Prisma-backed implementation drops in
 * behind the same interface for production (see infra/ + apps/api/prisma).
 */
export interface Repo {
  listSnapshots(): SnapshotRecord[];
  getSnapshot(id: string): SnapshotRecord | undefined;
  addSnapshot(rec: Omit<SnapshotRecord, 'id'>): SnapshotRecord;
  listClients(): Client[];
  getClient(id: string): Client | undefined;
  addClient(c: Omit<Client, 'id' | 'createdAt'>): Client;
  listJobs(): Job[];
  getJob(id: string): Job | undefined;
  addJob(j: Omit<Job, 'id' | 'createdAt' | 'updatedAt'>): Job;
  updateJob(id: string, patch: Partial<Job>): Job | undefined;
}

let seq = 1;
const id = (p: string) => `${p}_${(seq++).toString(36)}${Date.now().toString(36)}`;
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

  listSnapshots() {
    return [...this.snapshots.values()].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  }
  getSnapshot(sid: string) {
    return this.snapshots.get(sid);
  }
  addSnapshot(rec: Omit<SnapshotRecord, 'id'>) {
    const full: SnapshotRecord = { ...rec, id: id('snap') };
    this.snapshots.set(full.id, full);
    return full;
  }

  listClients() {
    return [...this.clients.values()];
  }
  getClient(cid: string) {
    return this.clients.get(cid);
  }
  addClient(c: Omit<Client, 'id' | 'createdAt'>) {
    const full: Client = { ...c, id: id('client'), createdAt: now() };
    this.clients.set(full.id, full);
    return full;
  }

  listJobs() {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  getJob(jid: string) {
    return this.jobs.get(jid);
  }
  addJob(j: Omit<Job, 'id' | 'createdAt' | 'updatedAt'>) {
    const full: Job = { ...j, id: id('job'), createdAt: now(), updatedAt: now() };
    this.jobs.set(full.id, full);
    return full;
  }
  updateJob(jid: string, patch: Partial<Job>) {
    const j = this.jobs.get(jid);
    if (!j) return undefined;
    const next = { ...j, ...patch, updatedAt: now() };
    this.jobs.set(jid, next);
    return next;
  }
}
