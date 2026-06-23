import { z } from 'zod';

/**
 * Internal, portable reference id used *inside* a snapshot in place of any raw
 * Discord snowflake. Snapshot capture assigns a stable `localRef` to every role,
 * channel, category, emoji, sticker, member, etc.; rebuild maps `localRef -> new
 * Discord id`. This indirection is what makes a snapshot portable across unlimited
 * target guilds and makes rebuilds idempotent. NEVER store raw Discord ids in a
 * snapshot's cross-references.
 *
 * Convention: `<kind>_<slug-or-counter>` e.g. `role_admins`, `chan_welcome`, `emoji_3`.
 */
export const LocalRef = z.string().min(1).max(190);
export type LocalRef = z.infer<typeof LocalRef>;

/** A Discord snowflake (id), stored only on the *source* side of a capture for traceability. */
export const Snowflake = z.string().regex(/^\d{15,21}$/, 'must be a Discord snowflake');
export type Snowflake = z.infer<typeof Snowflake>;

/**
 * Discord permission bitfields are 64-bit and serialize as a decimal string in the API.
 * We keep them as decimal strings so no precision is lost (a JS number cannot hold them).
 */
export const PermissionBits = z
  .string()
  .regex(/^\d+$/, 'permission bitfield must be a decimal string')
  .default('0');
export type PermissionBits = z.infer<typeof PermissionBits>;

/** Discord stores role/embed colors as a 24-bit integer (0x000000–0xFFFFFF). 0 = "no color". */
export const ColorInt = z.number().int().min(0).max(0xffffff);
export type ColorInt = z.infer<typeof ColorInt>;

/** Operator-facing hex color, e.g. `#7C3AED`. Used in brand tokens & RebrandConfig color maps. */
export const HexColor = z.string().regex(/^#?[0-9a-fA-F]{6}$/, 'must be a 6-digit hex color');
export type HexColor = z.infer<typeof HexColor>;

/** Any http(s) URL. */
export const Url = z.string().url();

/**
 * Object-storage key for persisted asset bytes (icons, banners, emoji/sticker images).
 * The snapshot holds the *key*, not the bytes; bytes live in disk/S3 keyed by content hash.
 * Shape: `assets/<sha256>.<ext>`.
 */
export const AssetKey = z.string().regex(/^assets\/[0-9a-f]{8,64}\.[a-z0-9]+$/i, 'invalid asset key');
export type AssetKey = z.infer<typeof AssetKey>;

/** ISO-8601 timestamp string. */
export const IsoTimestamp = z.string().datetime({ offset: true });

export const SCHEMA_VERSION = '1.0.0' as const;
