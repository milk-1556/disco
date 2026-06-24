/**
 * Pre-flight authority audit (§ before a live run). Given the bot's effective permission bitfield in
 * a guild, verify it has everything Disco needs — and name precisely what's missing — BEFORE a build
 * touches the guild, so a half-built server from a perms gap never happens.
 */
const ADMINISTRATOR = 1n << 3n;

export const REQUIRED_PERMISSIONS: { name: string; bit: bigint; why: string }[] = [
  { name: 'View Channels', bit: 1n << 10n, why: 'enumerate the structure' },
  { name: 'Manage Channels', bit: 1n << 4n, why: 'create channels & categories' },
  { name: 'Manage Roles', bit: 1n << 28n, why: 'create roles & set overwrites' },
  { name: 'Manage Server', bit: 1n << 5n, why: 'guild settings + AutoMod' },
  { name: 'Manage Webhooks', bit: 1n << 29n, why: 'copy info-channel content' },
  { name: 'Manage Expressions', bit: 1n << 30n, why: 're-upload emojis & stickers' },
  { name: 'Manage Messages', bit: 1n << 13n, why: 're-pin copied messages' },
  { name: 'Read Message History', bit: 1n << 16n, why: 'read info-channel content' },
];

export interface AuthorityAudit {
  ok: boolean;
  hasAdmin: boolean;
  missing: { name: string; why: string }[];
  permissions: string;
}

/** Audit a bot permission bitfield (decimal string) against what Disco requires. */
export function auditAuthority(permissions: string): AuthorityAudit {
  let bits: bigint;
  try {
    bits = BigInt(permissions);
  } catch {
    bits = 0n;
  }
  const hasAdmin = (bits & ADMINISTRATOR) === ADMINISTRATOR;
  const missing = hasAdmin
    ? []
    : REQUIRED_PERMISSIONS.filter((p) => (bits & p.bit) !== p.bit).map((p) => ({ name: p.name, why: p.why }));
  return { ok: hasAdmin || missing.length === 0, hasAdmin, missing, permissions };
}

// Discord hard limits per guild (and boost-tier-gated slot counts).
const ROLE_LIMIT = 250;
const CHANNEL_LIMIT = 500;
const EMOJI_SLOTS = [50, 100, 150, 250]; // by premium tier 0..3 (static)
const STICKER_SLOTS = [5, 15, 30, 60];
const AUTOMOD_PER_TRIGGER: Record<number, number> = { 1: 6, 3: 1, 4: 1, 5: 1, 6: 1 }; // keyword 6, others 1
const TRIGGER_NAME: Record<number, string> = { 1: 'keyword', 3: 'spam', 4: 'keyword-preset', 5: 'mention-spam', 6: 'member-profile' };

export interface LimitFinding {
  name: string;
  detail: string;
  severity: 'block' | 'warn';
}
export interface BuildFeasibility {
  ok: boolean; // false only if a hard limit would be exceeded (a 'block')
  findings: LimitFinding[];
}

// Boost tier a perk first becomes available at (a guild banner needs tier 2, an invite splash tier 1, …).
const BANNER_TIER = 2;
const SPLASH_TIER = 1;
const ROLE_ICON_TIER = 2;
const ROLE_COLOR_TIER = 2; // gradient / holographic "enhanced" role colors

/**
 * Will this snapshot actually fit into the TARGET Discord guild *at its current boost tier*? Audits the
 * structural hard limits (roles, channels → blocks) and every boost-locked item the build would try to
 * write — emoji/sticker slots, the guild banner & invite splash, and role icons & gradient colors — so
 * the operator sees exactly what won't land BEFORE committing (and can boost the guild, or build anyway
 * and let those items skip). `targetTier` is the destination guild's tier (0 = a fresh, unboosted guild,
 * the safe default); the snapshot's own `premiumTier` is where the template was captured from.
 */
export function auditBuildLimits(
  snap: {
    roles: { colors?: { secondary: number | null } | null; icon?: string | null }[];
    channels: unknown[];
    categories: unknown[];
    emojis: unknown[];
    stickers: unknown[];
    automod: { triggerType: number }[];
    guild: { premiumTier: number; assets?: { banner?: string | null; splash?: string | null } };
  },
  targetTier = 0,
): BuildFeasibility {
  const findings: LimitFinding[] = [];
  const sourceTier = snap.guild.premiumTier;
  const at = `target = tier ${targetTier}`;

  // ── structural hard limits (a real block — the build can't proceed) ──
  if (snap.roles.length > ROLE_LIMIT)
    findings.push({ name: 'Roles', detail: `${snap.roles.length} roles exceeds Discord's ${ROLE_LIMIT}-role limit.`, severity: 'block' });
  const channels = snap.channels.length + snap.categories.length;
  if (channels > CHANNEL_LIMIT)
    findings.push({ name: 'Channels', detail: `${channels} channels+categories exceeds the ${CHANNEL_LIMIT} limit.`, severity: 'block' });

  // ── boost-locked slots, measured against the TARGET tier (these skip, they don't block) ──
  const emojiSlots = EMOJI_SLOTS[targetTier] ?? 50;
  if (snap.emojis.length > emojiSlots)
    findings.push({ name: 'Emojis', detail: `${snap.emojis.length} emojis exceeds the ${emojiSlots} slots at ${at} — ${snap.emojis.length - emojiSlots} would skip until the guild is boosted.`, severity: 'warn' });
  const stickerSlots = STICKER_SLOTS[targetTier] ?? 5;
  if (snap.stickers.length > stickerSlots)
    findings.push({ name: 'Stickers', detail: `${snap.stickers.length} stickers exceeds the ${stickerSlots} slots at ${at} — ${snap.stickers.length - stickerSlots} would skip until the guild is boosted.`, severity: 'warn' });

  // ── boost-locked features the rebuild would attempt: banner, splash, role icons, gradient colors ──
  if (snap.guild.assets?.banner && targetTier < BANNER_TIER)
    findings.push({ name: 'Server banner', detail: `The server banner needs boost tier ${BANNER_TIER}; ${at}. It will skip until the guild is boosted.`, severity: 'warn' });
  if (snap.guild.assets?.splash && targetTier < SPLASH_TIER)
    findings.push({ name: 'Invite splash', detail: `The invite splash needs boost tier ${SPLASH_TIER}; ${at}. It will skip until the guild is boosted.`, severity: 'warn' });
  const roleIcons = snap.roles.filter((r) => r.icon).length;
  if (roleIcons > 0 && targetTier < ROLE_ICON_TIER)
    findings.push({ name: 'Role icons', detail: `${roleIcons} role icon${roleIcons === 1 ? '' : 's'} need boost tier ${ROLE_ICON_TIER}; ${at}. They will skip until the guild is boosted.`, severity: 'warn' });
  const gradientRoles = snap.roles.filter((r) => r.colors?.secondary != null).length;
  if (gradientRoles > 0 && targetTier < ROLE_COLOR_TIER)
    findings.push({ name: 'Role colors', detail: `${gradientRoles} boost-locked role color${gradientRoles === 1 ? '' : 's'} (gradient/holographic) need boost tier ${ROLE_COLOR_TIER}; ${at}. They fall back to a solid color until boosted.`, severity: 'warn' });

  // ── AutoMod rules per trigger type ──
  const byTrigger = new Map<number, number>();
  for (const r of snap.automod) byTrigger.set(r.triggerType, (byTrigger.get(r.triggerType) ?? 0) + 1);
  for (const [trigger, count] of byTrigger) {
    const limit = AUTOMOD_PER_TRIGGER[trigger] ?? 1;
    if (count > limit)
      findings.push({ name: 'AutoMod', detail: `${count} ${TRIGGER_NAME[trigger] ?? 'rule'} rules exceeds Discord's ${limit} per type.`, severity: 'warn' });
  }

  // ── a general nudge when the template came from a more-boosted guild than the target ──
  if (sourceTier > targetTier)
    findings.push({ name: 'Boost perks', detail: `Template was captured at boost tier ${sourceTier}; ${at}. Boost the target to tier ${sourceTier} to land every perk.`, severity: 'warn' });

  return { ok: !findings.some((f) => f.severity === 'block'), findings };
}

/** Compute an effective permission bitfield from a set of role permission bitfields (OR-combined). */
export function combineRolePermissions(rolePermissions: string[]): string {
  let acc = 0n;
  for (const p of rolePermissions) {
    try {
      acc |= BigInt(p);
    } catch {
      /* skip malformed */
    }
  }
  return acc.toString();
}
