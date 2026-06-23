import { z } from 'zod';
import { AutoModRule } from './automod.js';
import { BrandToken } from './brand.js';
import { DetectedBot } from './bot.js';
import { Category, Channel } from './channel.js';
import { ChannelContent } from './content.js';
import { Emoji, Sticker } from './expression.js';
import { GuildSettings } from './guild.js';
import { IsoTimestamp, SCHEMA_VERSION, Snowflake } from './primitives.js';
import { Role } from './role.js';

export const SnapshotSource = z.object({
  guildId: Snowflake,
  name: z.string(),
  ownerNote: z.string().default(''),
});

/**
 * A complete, self-contained, portable description of a guild's *clonable* state. The spine of
 * Disco. Every cross-reference uses internal `localRef`s, never raw Discord ids, so one snapshot
 * rebuilds into unlimited target guilds idempotently. (§3)
 */
export const Snapshot = z.object({
  schemaVersion: z.string().default(SCHEMA_VERSION),
  capturedAt: IsoTimestamp,
  source: SnapshotSource,
  guild: GuildSettings,
  roles: z.array(Role).default([]),
  categories: z.array(Category).default([]),
  channels: z.array(Channel).default([]),
  emojis: z.array(Emoji).default([]),
  stickers: z.array(Sticker).default([]),
  automod: z.array(AutoModRule).default([]),
  bots: z.array(DetectedBot).default([]),
  /** Only for channels classified system_content (§5). */
  content: z.array(ChannelContent).default([]),
  /** Auto-extracted rebrand candidates (§4). */
  brandTokens: z.array(BrandToken).default([]),
});
export type Snapshot = z.infer<typeof Snapshot>;

/** A persisted, versioned snapshot row's metadata (the artifact itself is `snapshot`). */
export const SnapshotRecord = z.object({
  id: z.string(),
  name: z.string(),
  version: z.number().int().min(1),
  sourceGuildId: Snowflake,
  capturedAt: IsoTimestamp,
  schemaVersion: z.string(),
  snapshot: Snapshot,
});
export type SnapshotRecord = z.infer<typeof SnapshotRecord>;
