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

/**
 * Will this snapshot actually fit into a fresh Discord guild? Audits the structural hard limits
 * (roles, channels, emoji/sticker slots by boost tier, AutoMod rules per trigger type) and the
 * boost-locked perks — so a build never half-succeeds against a limit. Sandbox-checkable (§ pre-flight).
 */
export function auditBuildLimits(snap: {
  roles: unknown[];
  channels: unknown[];
  categories: unknown[];
  emojis: unknown[];
  stickers: unknown[];
  automod: { triggerType: number }[];
  guild: { premiumTier: number };
}): BuildFeasibility {
  const findings: LimitFinding[] = [];
  const tier = snap.guild.premiumTier;

  if (snap.roles.length > ROLE_LIMIT)
    findings.push({ name: 'Roles', detail: `${snap.roles.length} roles exceeds Discord's ${ROLE_LIMIT}-role limit.`, severity: 'block' });
  const channels = snap.channels.length + snap.categories.length;
  if (channels > CHANNEL_LIMIT)
    findings.push({ name: 'Channels', detail: `${channels} channels+categories exceeds the ${CHANNEL_LIMIT} limit.`, severity: 'block' });

  const emojiSlots = EMOJI_SLOTS[tier] ?? 50;
  if (snap.emojis.length > emojiSlots)
    findings.push({ name: 'Emojis', detail: `${snap.emojis.length} emojis exceeds the ${emojiSlots} slots at boost tier ${tier}.`, severity: 'warn' });
  const stickerSlots = STICKER_SLOTS[tier] ?? 5;
  if (snap.stickers.length > stickerSlots)
    findings.push({ name: 'Stickers', detail: `${snap.stickers.length} stickers exceeds the ${stickerSlots} slots at boost tier ${tier}.`, severity: 'warn' });

  const byTrigger = new Map<number, number>();
  for (const r of snap.automod) byTrigger.set(r.triggerType, (byTrigger.get(r.triggerType) ?? 0) + 1);
  for (const [trigger, count] of byTrigger) {
    const limit = AUTOMOD_PER_TRIGGER[trigger] ?? 1;
    if (count > limit)
      findings.push({ name: 'AutoMod', detail: `${count} ${TRIGGER_NAME[trigger] ?? 'rule'} rules exceeds Discord's ${limit} per type.`, severity: 'warn' });
  }

  if (tier > 0)
    findings.push({ name: 'Boost perks', detail: `Source was boost tier ${tier}; banner, vanity URL and extra slots only apply once the target reaches it.`, severity: 'warn' });

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
