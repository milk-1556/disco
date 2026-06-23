import { z } from 'zod';
import { AssetKey, LocalRef, Snowflake } from './primitives.js';

/** Custom emoji. Bytes are downloaded from source and re-uploaded to target on rebuild. */
export const Emoji = z.object({
  localRef: LocalRef,
  sourceId: Snowflake.optional(),
  name: z.string().min(2).max(32),
  /** Stored image bytes (png/gif/webp) keyed in object storage. */
  asset: AssetKey,
  animated: z.boolean().default(false),
  /** Roles allowed to use this emoji (localRefs). Empty = everyone. */
  roleRefs: z.array(LocalRef).default([]),
  /** Managed emojis come from integrations (e.g. Twitch) and are skipped on rebuild. */
  managed: z.boolean().default(false),
});
export type Emoji = z.infer<typeof Emoji>;

/** Custom sticker. Bytes re-uploaded on rebuild. */
export const Sticker = z.object({
  localRef: LocalRef,
  sourceId: Snowflake.optional(),
  name: z.string().min(2).max(30),
  description: z.string().max(100).nullable().default(null),
  /** Autocomplete/suggestion tags — a unicode emoji or comma list per Discord. */
  tags: z.string().max(200),
  asset: AssetKey,
  /** 1 png, 2 apng, 3 lottie, 4 gif. Lottie requires the VERIFIED/PARTNER feature on target. */
  formatType: z.number().int().min(1).max(4),
});
export type Sticker = z.infer<typeof Sticker>;
