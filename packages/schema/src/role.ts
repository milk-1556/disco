import { z } from 'zod';
import { AssetKey, ColorInt, LocalRef, PermissionBits, Snowflake } from './primitives.js';

/**
 * Discord's newer two/three-tone role colors. `primary` mirrors the legacy `color`.
 * `secondary`/`tertiary` are only honored on guilds with the role-colors feature;
 * rebuild applies them best-effort and ignores failures.
 */
export const RoleColors = z.object({
  primary: ColorInt,
  secondary: ColorInt.nullable().default(null),
  tertiary: ColorInt.nullable().default(null),
});
export type RoleColors = z.infer<typeof RoleColors>;

/**
 * Discord role tags — how we recognize *managed* roles that cannot be recreated as plain
 * roles (bot roles, integration roles, the boost role, etc.). Captured for detection/flags.
 */
export const RoleTags = z
  .object({
    botId: Snowflake.optional(),
    integrationId: Snowflake.optional(),
    premiumSubscriber: z.boolean().optional(),
    availableForPurchase: z.boolean().optional(),
    guildConnections: z.boolean().optional(),
  })
  .strict();
export type RoleTags = z.infer<typeof RoleTags>;

export const Role = z.object({
  localRef: LocalRef,
  /** Source snowflake, for traceability/diffing only. Never used as a cross-reference. */
  sourceId: Snowflake.optional(),
  name: z.string().max(100),
  /** True for @everyone — recreated by *editing* the target's existing @everyone, not creating. */
  isEveryone: z.boolean().default(false),
  colors: RoleColors,
  hoist: z.boolean().default(false),
  /** Higher = nearer the top of the role list. Captured to reconcile order on rebuild. */
  position: z.number().int().min(0),
  permissions: PermissionBits,
  mentionable: z.boolean().default(false),
  /**
   * Managed roles are owned by a bot/integration and CANNOT be recreated as normal roles.
   * Rebuild skips creating these and the owning bot is surfaced in the Bot Setup Checklist.
   */
  managed: z.boolean().default(false),
  tags: RoleTags.optional(),
  icon: AssetKey.optional(),
  unicodeEmoji: z.string().optional(),
});
export type Role = z.infer<typeof Role>;
