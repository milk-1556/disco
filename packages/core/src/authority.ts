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
