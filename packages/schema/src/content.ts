import { z } from 'zod';
import { ColorInt, LocalRef, Snowflake, Url } from './primitives.js';

export const EmbedField = z.object({
  name: z.string().max(256),
  value: z.string().max(1024),
  inline: z.boolean().default(false),
});

/** Rich embed, rebuilt field-by-field so rebrand swaps apply to every text/color/url. */
export const Embed = z.object({
  title: z.string().max(256).nullable().default(null),
  description: z.string().max(4096).nullable().default(null),
  url: Url.nullable().default(null),
  color: ColorInt.nullable().default(null),
  authorName: z.string().max(256).nullable().default(null),
  authorUrl: Url.nullable().default(null),
  authorIconUrl: Url.nullable().default(null),
  footerText: z.string().max(2048).nullable().default(null),
  footerIconUrl: Url.nullable().default(null),
  imageUrl: Url.nullable().default(null),
  thumbnailUrl: Url.nullable().default(null),
  timestamp: z.string().nullable().default(null),
  fields: z.array(EmbedField).max(25).default([]),
});
export type Embed = z.infer<typeof Embed>;

/**
 * One captured message from a system/info channel, re-posted via webhook on rebuild. Buttons/select
 * menus are captured *visually* (label/style/url) but reaction-role/ticket interactivity won't
 * function until the owning bot is reconfigured — flagged in the report. (§5)
 */
export const CapturedMessage = z.object({
  sourceId: Snowflake.optional(),
  /** Author identity to render the webhook post as, when "preserve author" mode is chosen. */
  authorName: z.string(),
  authorAvatarUrl: Url.nullable().default(null),
  /** True if the original author was a bot/webhook (affects copy fidelity expectations). */
  authorIsBot: z.boolean().default(false),
  content: z.string().max(4000).default(''),
  embeds: z.array(Embed).default([]),
  pinned: z.boolean().default(false),
  /** Visual-only record of component rows (buttons/selects) for fidelity + manual-step flagging. */
  componentSummary: z.array(z.string()).default([]),
  createdAt: z.string().nullable().default(null),
});
export type CapturedMessage = z.infer<typeof CapturedMessage>;

export const ChannelContent = z.object({
  channelRef: LocalRef,
  messages: z.array(CapturedMessage).default([]),
  /** True if any message had interactive components needing bot reconfiguration. */
  hasInteractiveComponents: z.boolean().default(false),
});
export type ChannelContent = z.infer<typeof ChannelContent>;
