import { z } from 'zod';
import { LocalRef, Snowflake } from './primitives.js';

/**
 * A readable trace a bot left behind in the guild — the only thing the API exposes about a
 * third-party bot. We record these so the operator knows what the bot *was* wired to, even
 * though we can't copy its off-guild config.
 */
export const BotConfigTrace = z.object({
  kind: z.enum(['permission_overwrite', 'webhook', 'automod_rule', 'managed_role', 'integration']),
  /** Human-readable location, e.g. "#tickets overwrite", "webhook 'Ticket Tool'". */
  where: z.string(),
  /** Optional localRef into the snapshot (channel/role/webhook/automod this trace points at). */
  ref: LocalRef.nullable().default(null),
  detail: z.string().nullable().default(null),
});
export type BotConfigTrace = z.infer<typeof BotConfigTrace>;

/**
 * A detected third-party bot. NOT cloneable — its config lives on the vendor's servers. Surfaced
 * in the Bot Setup Checklist with an invite link and a "what to reconfigure" note. (§1, §5, §6)
 */
/**
 * An actionable per-bot setup entry for the Bot Setup Checklist: a real OAuth re-invite URL (built
 * from the bot's own application id + the perms it typically needs) plus the steps to reconfigure it.
 * Third-party bot config lives on the vendor's servers and can't be cloned — this makes the manual
 * step as turnkey as possible. (§1, §6)
 */
export const BotSetupEntry = z.object({
  name: z.string(),
  vendor: z.string().nullable().default(null),
  /** discord.com/oauth2 re-invite URL with scopes + recommended permission integer pre-baked. */
  oauthUrl: z.string().url().nullable().default(null),
  /** The vendor's own dashboard/config link. */
  dashboardUrl: z.string().url().nullable().default(null),
  permissions: z.string().default('0'),
  /** Markdown-ready "what to reconfigure" bullets. */
  reconfigure: z.array(z.string()).default([]),
});
export type BotSetupEntry = z.infer<typeof BotSetupEntry>;

export const DetectedBot = z.object({
  localRef: LocalRef,
  sourceId: Snowflake,
  name: z.string(),
  /** Best-effort vendor recognition by application id / username (MEE6, Carl-bot, Dyno, …). */
  vendorGuess: z.string().nullable().default(null),
  /** Known OAuth invite URL for re-adding the bot, when the vendor is recognized. */
  inviteUrl: z.string().url().nullable().default(null),
  /** Recognized features to reconfigure (e.g. "reaction roles", "tickets", "welcome messages"). */
  reconfigureNotes: z.array(z.string()).default([]),
  configTraces: z.array(BotConfigTrace).default([]),
});
export type DetectedBot = z.infer<typeof DetectedBot>;
