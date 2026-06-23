import { z } from 'zod';
import { LocalRef, PermissionBits, Snowflake } from './primitives.js';

/**
 * Clonable guild channel kinds, mapped to discord.js v14 ChannelType. Threads are intentionally
 * excluded — they are ephemeral content, not structure. Forum/media posts are threads and are
 * not recreated; the forum/media *channel* and its tag config are.
 */
export const ChannelKind = z.enum([
  'text', // GUILD_TEXT (0)
  'voice', // GUILD_VOICE (2)
  'category', // GUILD_CATEGORY (4)
  'announcement', // GUILD_ANNOUNCEMENT (5)
  'stage', // GUILD_STAGE_VOICE (13)
  'forum', // GUILD_FORUM (15)
  'media', // GUILD_MEDIA (16)
]);
export type ChannelKind = z.infer<typeof ChannelKind>;

/** Per-role / per-member allow+deny overwrite. Targets reference snapshot localRefs, never raw ids. */
export const PermissionOverwrite = z.object({
  targetType: z.enum(['role', 'member']),
  /** localRef of a role or member in this snapshot. Member-target overwrites usually skip on rebuild. */
  targetRef: LocalRef,
  /** Original target snowflake, for traceability/diffing. */
  targetSourceId: Snowflake.optional(),
  allow: PermissionBits,
  deny: PermissionBits,
});
export type PermissionOverwrite = z.infer<typeof PermissionOverwrite>;

/** Forum/media tag. Emoji is either a unicode char or a reference to a custom emoji's localRef. */
export const ForumTag = z.object({
  localRef: LocalRef,
  name: z.string().max(20),
  moderated: z.boolean().default(false),
  emojiUnicode: z.string().nullable().default(null),
  emojiRef: LocalRef.nullable().default(null),
});
export type ForumTag = z.infer<typeof ForumTag>;

export const DefaultReaction = z.object({
  emojiUnicode: z.string().nullable().default(null),
  emojiRef: LocalRef.nullable().default(null),
});

/** Discord forum sort/layout enums kept as ints to mirror the API. */
export const ForumLayout = z.number().int().min(0).max(2); // 0 not set, 1 list, 2 gallery
export const SortOrder = z.number().int().min(0).max(1); // 0 latest activity, 1 creation date

/**
 * How content of this channel should be treated by the copy engine.
 *  - system_content: rules/info/welcome/links/role-select — copyable via webhook (default ON)
 *  - member_chat: ordinary conversation — content is NEVER copied (default OFF, de-emphasized)
 */
export const CopyPolicy = z.enum(['system_content', 'member_chat']);
export type CopyPolicy = z.infer<typeof CopyPolicy>;

export const Channel = z.object({
  localRef: LocalRef,
  sourceId: Snowflake.optional(),
  kind: ChannelKind,
  name: z.string().max(100),
  /** Parent category localRef, or null for top-level / category channels themselves. */
  categoryRef: LocalRef.nullable().default(null),
  /** Position within its parent (or among top-level channels). Lower = higher in the list. */
  position: z.number().int().min(0),
  topic: z.string().max(4096).nullable().default(null),
  nsfw: z.boolean().default(false),
  /** Slowmode / rate-limit-per-user, seconds (text/forum). */
  rateLimitPerUser: z.number().int().min(0).max(21600).default(0),
  /** Voice/stage. */
  bitrate: z.number().int().min(8000).max(384000).nullable().default(null),
  userLimit: z.number().int().min(0).max(99).nullable().default(null),
  rtcRegion: z.string().nullable().default(null),
  videoQualityMode: z.number().int().min(1).max(2).nullable().default(null),
  /** Forum/media. */
  forumTags: z.array(ForumTag).default([]),
  defaultReaction: DefaultReaction.nullable().default(null),
  defaultForumLayout: ForumLayout.nullable().default(null),
  defaultSortOrder: SortOrder.nullable().default(null),
  defaultThreadRateLimitPerUser: z.number().int().min(0).max(21600).nullable().default(null),
  /** Default auto-archive for new threads, minutes (60, 1440, 4320, 10080). */
  defaultAutoArchiveDuration: z
    .union([z.literal(60), z.literal(1440), z.literal(4320), z.literal(10080)])
    .nullable()
    .default(null),
  overwrites: z.array(PermissionOverwrite).default([]),
  /** Classification driving the content-copy engine (§5). */
  copyPolicy: CopyPolicy,
  /** Operator toggle: should content actually be copied? Defaults follow copyPolicy. */
  copyContent: z.boolean().default(false),
});
export type Channel = z.infer<typeof Channel>;

/** A category is a channel of kind 'category'; modeled separately for clarity in the snapshot. */
export const Category = z.object({
  localRef: LocalRef,
  sourceId: Snowflake.optional(),
  name: z.string().max(100),
  position: z.number().int().min(0),
  overwrites: z.array(PermissionOverwrite).default([]),
});
export type Category = z.infer<typeof Category>;
