/**
 * Discord permission bitfield → human-readable names. Drives the snapshot-diff per-permission expansion
 * (§3): an operator comparing two template versions sees "Allow: Send Messages, Read History · Deny:
 * Mention Everyone" instead of an opaque decimal like "274877906944". Labels match Discord's own UI.
 */
export const PERMISSION_LABELS: { bit: bigint; label: string }[] = [
  { bit: 1n << 0n, label: 'Create Invite' },
  { bit: 1n << 1n, label: 'Kick Members' },
  { bit: 1n << 2n, label: 'Ban Members' },
  { bit: 1n << 3n, label: 'Administrator' },
  { bit: 1n << 4n, label: 'Manage Channels' },
  { bit: 1n << 5n, label: 'Manage Server' },
  { bit: 1n << 6n, label: 'Add Reactions' },
  { bit: 1n << 7n, label: 'View Audit Log' },
  { bit: 1n << 8n, label: 'Priority Speaker' },
  { bit: 1n << 9n, label: 'Video' },
  { bit: 1n << 10n, label: 'View Channel' },
  { bit: 1n << 11n, label: 'Send Messages' },
  { bit: 1n << 12n, label: 'Send TTS Messages' },
  { bit: 1n << 13n, label: 'Manage Messages' },
  { bit: 1n << 14n, label: 'Embed Links' },
  { bit: 1n << 15n, label: 'Attach Files' },
  { bit: 1n << 16n, label: 'Read History' },
  { bit: 1n << 17n, label: 'Mention Everyone' },
  { bit: 1n << 18n, label: 'Use External Emoji' },
  { bit: 1n << 19n, label: 'View Server Insights' },
  { bit: 1n << 20n, label: 'Connect' },
  { bit: 1n << 21n, label: 'Speak' },
  { bit: 1n << 22n, label: 'Mute Members' },
  { bit: 1n << 23n, label: 'Deafen Members' },
  { bit: 1n << 24n, label: 'Move Members' },
  { bit: 1n << 25n, label: 'Use Voice Activity' },
  { bit: 1n << 26n, label: 'Change Nickname' },
  { bit: 1n << 27n, label: 'Manage Nicknames' },
  { bit: 1n << 28n, label: 'Manage Roles' },
  { bit: 1n << 29n, label: 'Manage Webhooks' },
  { bit: 1n << 30n, label: 'Manage Expressions' },
  { bit: 1n << 31n, label: 'Use App Commands' },
  { bit: 1n << 32n, label: 'Request to Speak' },
  { bit: 1n << 33n, label: 'Manage Events' },
  { bit: 1n << 34n, label: 'Manage Threads' },
  { bit: 1n << 35n, label: 'Create Public Threads' },
  { bit: 1n << 36n, label: 'Create Private Threads' },
  { bit: 1n << 37n, label: 'Use External Stickers' },
  { bit: 1n << 38n, label: 'Send in Threads' },
  { bit: 1n << 39n, label: 'Use Activities' },
  { bit: 1n << 40n, label: 'Timeout Members' },
  { bit: 1n << 41n, label: 'View Monetization Analytics' },
  { bit: 1n << 42n, label: 'Use Soundboard' },
  { bit: 1n << 43n, label: 'Create Expressions' },
  { bit: 1n << 44n, label: 'Create Events' },
  { bit: 1n << 45n, label: 'Use External Sounds' },
  { bit: 1n << 46n, label: 'Send Voice Messages' },
];

function toBig(bitfield: string): bigint {
  try {
    return BigInt(bitfield || '0');
  } catch {
    return 0n;
  }
}

/** Decode a permission bitfield (decimal string) into the set of permission labels it grants. */
export function decodePermissions(bitfield: string): string[] {
  const bits = toBig(bitfield);
  return PERMISSION_LABELS.filter((p) => (bits & p.bit) === p.bit).map((p) => p.label);
}

export interface PermissionDelta {
  added: string[];
  removed: string[];
}

/** What changed between two permission bitfields — which permissions were newly granted vs revoked. */
export function diffPermissions(before: string, after: string): PermissionDelta {
  const a = toBig(before);
  const b = toBig(after);
  const added: string[] = [];
  const removed: string[] = [];
  for (const p of PERMISSION_LABELS) {
    const had = (a & p.bit) === p.bit;
    const has = (b & p.bit) === p.bit;
    if (has && !had) added.push(p.label);
    else if (had && !has) removed.push(p.label);
  }
  return { added, removed };
}
