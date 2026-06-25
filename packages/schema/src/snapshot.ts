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
  /** Operator curation: free-form tags ("gambling", "irl-vlogger"), a note, favorite + template flags. */
  tags: z.array(z.string()).default([]),
  note: z.string().default(''),
  favorite: z.boolean().default(false),
  /** Promoted to a reusable master template (a first-class product SKU). */
  isTemplate: z.boolean().default(false),
  /** Bumped whenever this snapshot is used for a build — drives "sort by last used". */
  lastUsedAt: z.string().nullable().default(null),
  /** The operator who owns this record (multi-operator access scoping). Defaults to the sole operator. */
  ownerEmail: z.string().default(''),
  /** Shared to the cross-operator template marketplace (structure-only; private fields are never shared). */
  shared: z.boolean().default(false),
});
export type SnapshotRecord = z.infer<typeof SnapshotRecord>;

/** Operator-editable curation fields on a snapshot. */
export const SnapshotMetaPatch = z
  .object({
    name: z.string().min(1),
    tags: z.array(z.string()),
    note: z.string(),
    favorite: z.boolean(),
    isTemplate: z.boolean(),
    shared: z.boolean(),
    lastUsedAt: z.string().nullable(),
  })
  .partial();
export type SnapshotMetaPatch = z.infer<typeof SnapshotMetaPatch>;
