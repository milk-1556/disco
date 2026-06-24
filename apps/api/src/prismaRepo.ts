import {
  type Client,
  type Handover,
  type Job,
  JobManifest,
  type OwnershipStep,
  RebrandConfig,
  RebuildReport,
  Snapshot,
  type SnapshotMetaPatch,
  type SnapshotRecord,
} from '@disco/schema';
import { Prisma, PrismaClient } from '@prisma/client';
import type { AuditEntry, HandoverCreate, HandoverPatch, Repo, SnapshotCreate } from './repo.js';

let _prisma: PrismaClient | undefined;
/** Memoized singleton PrismaClient (one pool per process). */
export function getPrisma(): PrismaClient {
  return (_prisma ??= new PrismaClient());
}

const iso = (d: Date) => d.toISOString();
const asJson = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;
/** Tolerant read: parse a Json column through its zod schema, returning null on any mismatch. */
function safe<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } }, v: unknown): T | null {
  if (v === null || v === undefined) return null;
  const r = schema.safeParse(v);
  return r.success ? r.data : null;
}
/** Nullable Json column setter: JS null must become a DB NULL, not a JSON `null` literal. */
const nullableJson = (v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull =>
  v === null || v === undefined ? Prisma.DbNull : (v as Prisma.InputJsonValue);

/**
 * Postgres-backed Repo (selected by DATABASE_URL). Json columns are re-validated through their zod
 * schemas on read so the round-trip restores defaults losslessly — execute.ts resume depends on the
 * exact manifest shape (steps/entries/idMap). Shares the Job.manifest column with the worker as the
 * single source of truth for resumable, non-duplicating retries.
 */
export class PrismaRepo implements Repo {
  private db = getPrisma();

  // ── snapshots ──
  private toSnapshot = (r: {
    id: string; name: string; version: number; sourceGuildId: string; schemaVersion: string; capturedAt: Date; artifact: Prisma.JsonValue;
    tags: string[]; note: string; favorite: boolean; isTemplate: boolean; lastUsedAt: Date | null;
  }): SnapshotRecord => ({
    id: r.id,
    name: r.name,
    version: r.version,
    sourceGuildId: r.sourceGuildId,
    schemaVersion: r.schemaVersion,
    capturedAt: iso(r.capturedAt),
    snapshot: Snapshot.parse(r.artifact),
    tags: r.tags,
    note: r.note,
    favorite: r.favorite,
    isTemplate: r.isTemplate,
    lastUsedAt: r.lastUsedAt ? iso(r.lastUsedAt) : null,
  });

  async listSnapshots() {
    const rows = await this.db.snapshot.findMany({ orderBy: { capturedAt: 'desc' } });
    return rows.map(this.toSnapshot);
  }
  async snapshotNames() {
    // select id+name only — never deserialize the (large) artifact JSON just to read a name
    return this.db.snapshot.findMany({ select: { id: true, name: true } });
  }
  async getSnapshot(id: string) {
    const r = await this.db.snapshot.findUnique({ where: { id } });
    return r ? this.toSnapshot(r) : undefined;
  }
  async addSnapshot(rec: SnapshotCreate) {
    const r = await this.db.snapshot.create({
      data: {
        name: rec.name,
        version: rec.version,
        sourceGuildId: rec.sourceGuildId,
        schemaVersion: rec.schemaVersion,
        capturedAt: new Date(rec.capturedAt),
        artifact: asJson(rec.snapshot),
      },
    });
    return this.toSnapshot(r);
  }
  async updateSnapshot(id: string, patch: SnapshotMetaPatch) {
    const data: Prisma.SnapshotUpdateInput = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.tags !== undefined) data.tags = patch.tags;
    if (patch.note !== undefined) data.note = patch.note;
    if (patch.favorite !== undefined) data.favorite = patch.favorite;
    if (patch.isTemplate !== undefined) data.isTemplate = patch.isTemplate;
    if (patch.lastUsedAt !== undefined) data.lastUsedAt = patch.lastUsedAt ? new Date(patch.lastUsedAt) : null;
    try {
      return this.toSnapshot(await this.db.snapshot.update({ where: { id }, data }));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') return undefined;
      throw err;
    }
  }
  async deleteSnapshot(id: string) {
    await this.db.job.updateMany({ where: { snapshotId: id }, data: { snapshotId: null } }); // unlink, keep builds
    await this.db.snapshot.delete({ where: { id } }).catch(() => {});
  }

  // ── clients ──
  private toClient = (r: {
    id: string; creatorName: string; handle: string; brandColors: string[]; links: string[]; termSwaps: Prisma.JsonValue; assets: Prisma.JsonValue; notes: string; buildPrice?: number; monthlyRetainer?: number; upsells?: Prisma.JsonValue; stripeSessionId?: string | null; createdAt: Date;
  }): Client => ({
    id: r.id,
    creatorName: r.creatorName,
    handle: r.handle,
    brandColors: r.brandColors,
    links: r.links,
    termSwaps: (r.termSwaps as { from: string; to: string }[]) ?? [],
    assets: (r.assets as Client['assets']) ?? {},
    notes: r.notes,
    buildPrice: r.buildPrice ?? 0,
    monthlyRetainer: r.monthlyRetainer ?? 0,
    upsells: (r.upsells as Client['upsells']) ?? [],
    stripeSessionId: r.stripeSessionId ?? null,
    createdAt: iso(r.createdAt),
  });

  async listClients() {
    return (await this.db.client.findMany({ orderBy: { createdAt: 'desc' } })).map(this.toClient);
  }
  async getClient(id: string) {
    const r = await this.db.client.findUnique({ where: { id } });
    return r ? this.toClient(r) : undefined;
  }
  async clientByStripeSession(sessionId: string) {
    const r = await this.db.client.findUnique({ where: { stripeSessionId: sessionId } });
    return r ? this.toClient(r) : undefined;
  }
  async addClient(c: Omit<Client, 'id' | 'createdAt'>) {
    const r = await this.db.client.create({
      data: {
        creatorName: c.creatorName,
        handle: c.handle,
        brandColors: c.brandColors,
        links: c.links,
        termSwaps: asJson(c.termSwaps),
        assets: asJson(c.assets),
        notes: c.notes,
        buildPrice: c.buildPrice ?? 0,
        monthlyRetainer: c.monthlyRetainer ?? 0,
        upsells: asJson(c.upsells ?? []),
        stripeSessionId: c.stripeSessionId ?? null,
      },
    });
    return this.toClient(r);
  }
  async deleteClient(id: string) {
    // unlink the client from any builds/handovers (keep the records), then remove the client
    await this.db.job.updateMany({ where: { clientId: id }, data: { clientId: null } });
    await this.db.handover.updateMany({ where: { clientId: id }, data: { clientId: null } });
    await this.db.client.delete({ where: { id } }).catch(() => {});
  }

  // ── jobs ──
  private toJob = (r: {
    id: string; kind: string; status: string; dryRun: boolean; progress: number; targetGuildId: string | null;
    rebrandConfig: Prisma.JsonValue; metrics: Prisma.JsonValue | null; manifest: Prisma.JsonValue | null; report: Prisma.JsonValue | null; error: string | null;
    snapshotId: string | null; clientId: string | null; createdAt: Date; updatedAt: Date;
  }): Job => ({
    id: r.id,
    kind: r.kind as Job['kind'],
    status: r.status as Job['status'],
    snapshotId: r.snapshotId,
    clientId: r.clientId,
    targetGuildId: r.targetGuildId,
    dryRun: r.dryRun,
    // safeParse + fallback: a single legacy/partial Json row must not 500 a whole listJobs().
    rebrandConfig: safe(RebrandConfig, r.rebrandConfig) ?? undefined,
    metrics: (r.metrics as Job['metrics']) ?? null,
    progress: r.progress,
    manifest: safe(JobManifest, r.manifest) ?? null,
    report: safe(RebuildReport, r.report) ?? null,
    error: r.error,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  });

  async listJobs() {
    return (await this.db.job.findMany({ orderBy: { createdAt: 'desc' } })).map(this.toJob);
  }
  async getJob(id: string) {
    const r = await this.db.job.findUnique({ where: { id } });
    return r ? this.toJob(r) : undefined;
  }
  async addJob(j: Omit<Job, 'id' | 'createdAt' | 'updatedAt'>) {
    const r = await this.db.job.create({
      data: {
        kind: j.kind,
        status: j.status,
        dryRun: j.dryRun,
        progress: j.progress,
        targetGuildId: j.targetGuildId,
        rebrandConfig: asJson(j.rebrandConfig ?? {}),
        metrics: nullableJson(j.metrics),
        manifest: nullableJson(j.manifest),
        report: nullableJson(j.report),
        error: j.error,
        snapshotId: j.snapshotId,
        clientId: j.clientId,
      },
    });
    return this.toJob(r);
  }
  async updateJob(id: string, patch: Partial<Job>) {
    const data: Prisma.JobUpdateInput = {};
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.progress !== undefined) data.progress = patch.progress;
    if (patch.error !== undefined) data.error = patch.error;
    if (patch.targetGuildId !== undefined) data.targetGuildId = patch.targetGuildId;
    if (patch.dryRun !== undefined) data.dryRun = patch.dryRun;
    if (patch.manifest !== undefined) data.manifest = nullableJson(patch.manifest);
    if (patch.report !== undefined) data.report = nullableJson(patch.report);
    if (patch.metrics !== undefined) data.metrics = nullableJson(patch.metrics);
    if (patch.rebrandConfig !== undefined) data.rebrandConfig = asJson(patch.rebrandConfig);
    try {
      return this.toJob(await this.db.job.update({ where: { id }, data }));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') return undefined;
      throw err;
    }
  }

  // ── handovers ──
  private toHandover = (r: {
    id: string; jobId: string; clientId: string | null; passwordHash: string | null; state: string;
    logoKey: string | null; welcomeMessage: string; ownershipSteps: Prisma.JsonValue; upsellStatus: string; createdAt: Date;
  }): Handover => ({
    id: r.id,
    jobId: r.jobId,
    clientId: r.clientId,
    state: r.state as Handover['state'],
    hasPassword: !!r.passwordHash,
    logoKey: r.logoKey,
    welcomeMessage: r.welcomeMessage,
    ownershipSteps: (r.ownershipSteps as OwnershipStep[]) ?? [],
    upsellStatus: r.upsellStatus as Handover['upsellStatus'],
    createdAt: iso(r.createdAt),
  });

  async getHandover(id: string) {
    const r = await this.db.handover.findUnique({ where: { id } });
    return r ? this.toHandover(r) : undefined;
  }
  async getHandoverByJob(jobId: string) {
    const r = await this.db.handover.findUnique({ where: { jobId } });
    return r ? this.toHandover(r) : undefined;
  }
  async addHandover(h: HandoverCreate) {
    const r = await this.db.handover.create({
      data: {
        jobId: h.jobId,
        clientId: h.clientId,
        state: h.state,
        passwordHash: h.passwordHash ?? null,
        ownershipSteps: asJson(h.ownershipSteps),
        upsellStatus: h.upsellStatus,
      },
    });
    return this.toHandover(r);
  }
  async updateHandover(id: string, patch: HandoverPatch) {
    const data: Prisma.HandoverUpdateInput = {};
    if (patch.state !== undefined) data.state = patch.state;
    if (patch.upsellStatus !== undefined) data.upsellStatus = patch.upsellStatus;
    if (patch.ownershipSteps !== undefined) data.ownershipSteps = asJson(patch.ownershipSteps);
    if (patch.passwordHash !== undefined) data.passwordHash = patch.passwordHash;
    if (patch.logoKey !== undefined) data.logoKey = patch.logoKey;
    if (patch.welcomeMessage !== undefined) data.welcomeMessage = patch.welcomeMessage;
    try {
      return this.toHandover(await this.db.handover.update({ where: { id }, data }));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') return undefined;
      throw err;
    }
  }
  async addAudit(e: Omit<AuditEntry, 'id' | 'at'>) {
    await this.db.auditLog.create({ data: { action: e.action, target: e.target, detail: e.detail, operator: e.operator } });
  }
  async listAudit(limit = 200) {
    const rows = await this.db.auditLog.findMany({ orderBy: { at: 'desc' }, take: limit });
    return rows.map((r) => ({ id: r.id, at: iso(r.at), action: r.action, target: r.target, detail: r.detail, operator: r.operator }));
  }

  async getHandoverPasswordHash(id: string) {
    const r = await this.db.handover.findUnique({ where: { id }, select: { passwordHash: true } });
    return r ? r.passwordHash : undefined;
  }
}
