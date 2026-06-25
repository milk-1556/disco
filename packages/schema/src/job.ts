import { z } from 'zod';
import { BotSetupEntry } from './bot.js';
import { LocalRef, Snowflake } from './primitives.js';
import { RebrandConfig } from './rebrand.js';

/** The dependency-ordered rebuild steps (§6). Order is significant and enforced by the engine. */
export const RebuildStep = z.enum([
  'guild_settings', // 1
  'roles', // 2
  'expressions', // 3 emojis + stickers
  'categories', // 4
  'channels', // 5
  'overwrites', // 6
  'automod', // 7
  'pointers', // 8 system/rules/public-updates/welcome
  'content', // 9
  'bot_detection', // 10
  'report', // 11
]);
export type RebuildStep = z.infer<typeof RebuildStep>;

export const REBUILD_STEP_ORDER: RebuildStep[] = [
  'guild_settings',
  'roles',
  'expressions',
  'categories',
  'channels',
  'overwrites',
  'automod',
  'pointers',
  'content',
  'bot_detection',
  'report',
];

export const JobKind = z.enum(['snapshot', 'rebuild']);
export const JobStatus = z.enum([
  'queued',
  'running',
  'paused', // e.g. rate-limit backoff / resumable interruption
  'completed',
  'failed',
  'canceled',
]);
export type JobStatus = z.infer<typeof JobStatus>;

/**
 * One created object's mapping, written BEFORE the engine proceeds, so a crash/resume reconciles
 * instead of duplicating. Match priority on resume: manifest entry → existing object by name+kind.
 */
export const ManifestEntry = z.object({
  localRef: LocalRef,
  kind: z.enum(['role', 'category', 'channel', 'emoji', 'sticker', 'automod', 'webhook']),
  /** Created/adopted id — a real Discord snowflake on a live build, or a `dry_*` placeholder in a dry-run. */
  newId: z.string().nullable().default(null),
  status: z.enum(['pending', 'created', 'updated', 'skipped', 'failed']).default('pending'),
  /** Reason for skip/fail (e.g. "managed role", "member overwrite for nonexistent user"). */
  note: z.string().nullable().default(null),
});
export type ManifestEntry = z.infer<typeof ManifestEntry>;

export const StepState = z.object({
  step: RebuildStep,
  status: z.enum(['pending', 'running', 'done', 'failed']).default('pending'),
  startedAt: z.string().nullable().default(null),
  finishedAt: z.string().nullable().default(null),
});
export type StepState = z.infer<typeof StepState>;

/** Persisted per-job progress that makes builds resumable (§6). */
export const JobManifest = z.object({
  jobId: z.string(),
  targetGuildId: Snowflake.nullable().default(null),
  dryRun: z.boolean().default(false),
  steps: z.array(StepState).default([]),
  entries: z.array(ManifestEntry).default([]),
  /** localRef -> new id (snowflake on live, `dry_*` placeholder in a dry-run), for fast rewrite lookup. */
  idMap: z.record(LocalRef, z.string()).default({}),
});
export type JobManifest = z.infer<typeof JobManifest>;

/** A guided manual step the operator must perform — for anything not cloneable (§1, §5, §6). */
export const ManualStep = z.object({
  title: z.string(),
  reason: z.string(),
  /** Optional link (bot invite/OAuth, Discord docs). */
  url: z.string().url().nullable().default(null),
  /** Related detected-bot localRef, if this step comes from bot detection. */
  botRef: LocalRef.nullable().default(null),
  category: z.enum(['bot', 'member_data', 'interactive', 'feature_gated', 'asset', 'other']),
});
export type ManualStep = z.infer<typeof ManualStep>;

/** The end-of-build Rebuild Report (§6 step 11, §7). */
export const RebuildReport = z.object({
  jobId: z.string(),
  dryRun: z.boolean(),
  targetGuildId: Snowflake.nullable().default(null),
  counts: z.record(z.string(), z.number()).default({}),
  created: z.array(z.string()).default([]),
  updated: z.array(z.string()).default([]),
  skipped: z.array(z.object({ ref: z.string(), reason: z.string() })).default([]),
  manualSteps: z.array(ManualStep).default([]),
  botChecklist: z.array(z.string()).default([]),
  /** Rich, actionable per-bot setup (OAuth re-invite URLs + reconfigure steps). */
  botSetup: z.array(BotSetupEntry).default([]),
  warnings: z.array(z.string()).default([]),
  generatedAt: z.string(),
});
export type RebuildReport = z.infer<typeof RebuildReport>;

export const Job = z.object({
  id: z.string(),
  kind: JobKind,
  status: JobStatus,
  snapshotId: z.string().nullable().default(null),
  clientId: z.string().nullable().default(null),
  targetGuildId: Snowflake.nullable().default(null),
  dryRun: z.boolean().default(false),
  /** Canary/test build — built to inspect before pointing at the real client guild; no handover. */
  canary: z.boolean().default(false),
  /** The rebrand config that produced this build — persisted so the worker can resume self-sufficiently. */
  rebrandConfig: RebrandConfig.optional(),
  /** Cost-analytics metrics captured at build time. */
  metrics: z
    .object({
      apiCalls: z.number().int().min(0),
      durationMs: z.number().int().min(0),
      objectsCreated: z.number().int().min(0),
    })
    .nullable()
    .default(null),
  progress: z.number().min(0).max(1).default(0),
  manifest: JobManifest.nullable().default(null),
  report: RebuildReport.nullable().default(null),
  error: z.string().nullable().default(null),
  /** The operator who owns this record (multi-operator access scoping). Defaults to the sole operator. */
  ownerEmail: z.string().default(''),
  /** Earnings tracker (#6): operator-entered amounts in cents. No payment processing — pure tracking. */
  invoicedCents: z.number().int().min(0).default(0),
  paidCents: z.number().int().min(0).default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Job = z.infer<typeof Job>;
