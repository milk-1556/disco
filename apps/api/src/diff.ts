import type { Snapshot } from '@disco/schema';
import { diffPermissions, type PermissionDelta } from '@disco/core';

export interface FieldChange {
  field: string;
  before: string;
  after: string;
}
export interface ChangedObject {
  name: string;
  fields: FieldChange[];
  /** Role-permission changes decoded into human-readable names (set when this is a role whose perms moved). */
  permissionDelta?: PermissionDelta;
}
export interface CategoryDiff {
  added: string[];
  removed: string[];
  changed: ChangedObject[];
}
/** A single channel/category permission-overwrite that changed between versions, decoded per-permission. */
export interface OverwriteChange {
  container: string; // channel or category name
  target: string; // the role/member localRef the overwrite applies to
  allow: PermissionDelta; // permissions newly allowed / no-longer allowed
  deny: PermissionDelta; // permissions newly denied / no-longer denied
}
export interface SnapshotDiff {
  guildNameChanged: { before: string; after: string } | null;
  roles: CategoryDiff;
  channels: CategoryDiff;
  categories: CategoryDiff;
  emojis: CategoryDiff;
  automod: CategoryDiff;
  /** Per-permission overwrite changes across channels + categories (the §3 expansion). */
  overwriteChanges: OverwriteChange[];
  counts: Record<string, { before: number; after: number }>;
}

const names = (xs: { name: string }[]) => new Set(xs.map((x) => x.name));

/** Per-field comparison of objects present in BOTH versions (matched by name). */
function diffCategory<T extends { name: string }>(
  a: T[],
  b: T[],
  fields: (x: T) => Record<string, unknown>,
): CategoryDiff {
  const sa = names(a);
  const sb = names(b);
  const byName = new Map(a.map((x) => [x.name, x]));
  const changed: ChangedObject[] = [];
  for (const after of b) {
    const before = byName.get(after.name);
    if (!before) continue;
    const fa = fields(before);
    const fb = fields(after);
    const fieldChanges: FieldChange[] = [];
    for (const key of Object.keys(fb)) {
      const bv = JSON.stringify(fa[key]);
      const av = JSON.stringify(fb[key]);
      if (bv !== av) fieldChanges.push({ field: key, before: trim(fa[key]), after: trim(fb[key]) });
    }
    if (fieldChanges.length) changed.push({ name: after.name, fields: fieldChanges });
  }
  return {
    added: [...sb].filter((n) => !sa.has(n)),
    removed: [...sa].filter((n) => !sb.has(n)),
    changed,
  };
}

function trim(v: unknown): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}

type OverwriteHolder = { name: string; overwrites: { targetRef: string; allow: string; deny: string }[] };

/** Decode the allow/deny permission changes for every channel/category overwrite that moved. */
function computeOverwriteChanges(before: Snapshot, after: Snapshot): OverwriteChange[] {
  const out: OverwriteChange[] = [];
  const containers: { a: OverwriteHolder[]; b: OverwriteHolder[] }[] = [
    { a: before.channels, b: after.channels },
    { a: before.categories, b: after.categories },
  ];
  for (const { a, b } of containers) {
    const beforeByName = new Map(a.map((c) => [c.name, c]));
    for (const cb of b) {
      const ca = beforeByName.get(cb.name);
      if (!ca) continue; // a brand-new container shows up under added, not as an overwrite change
      const beforeOws = new Map(ca.overwrites.map((o) => [o.targetRef, o]));
      const afterOws = new Map(cb.overwrites.map((o) => [o.targetRef, o]));
      const targets = new Set([...beforeOws.keys(), ...afterOws.keys()]);
      for (const target of targets) {
        const ow0 = beforeOws.get(target);
        const ow1 = afterOws.get(target);
        const allow = diffPermissions(ow0?.allow ?? '0', ow1?.allow ?? '0');
        const deny = diffPermissions(ow0?.deny ?? '0', ow1?.deny ?? '0');
        if (allow.added.length || allow.removed.length || deny.added.length || deny.removed.length)
          out.push({ container: cb.name, target, allow, deny });
      }
    }
  }
  return out;
}

/** Structural + per-field diff between two snapshot versions (drives the library diff view, §3). */
export function diffSnapshots(before: Snapshot, after: Snapshot): SnapshotDiff {
  const beforeRoles = new Map(before.roles.map((r) => [r.name, r]));
  const afterRoles = new Map(after.roles.map((r) => [r.name, r]));
  const diff: SnapshotDiff = {
    guildNameChanged: before.guild.name !== after.guild.name ? { before: before.guild.name, after: after.guild.name } : null,
    // `permissions` and `overwrites` are intentionally NOT raw-diffed here — they're decoded to
    // plain-English permission deltas below (roles) and in computeOverwriteChanges (channels/categories),
    // so the UI shows "+ Manage Channels" instead of an unreadable bitfield/`ref:allow/deny` string.
    roles: diffCategory(before.roles, after.roles, (r) => ({
      color: `#${r.colors.primary.toString(16).padStart(6, '0')}`,
      hoist: r.hoist,
      mentionable: r.mentionable,
      position: r.position,
    })),
    channels: diffCategory(before.channels, after.channels, (c) => ({
      topic: c.topic,
      nsfw: c.nsfw,
      slowmode: c.rateLimitPerUser,
      copyPolicy: c.copyPolicy,
    })),
    categories: diffCategory(before.categories, after.categories, (c) => ({
      position: c.position,
    })),
    emojis: diffCategory(before.emojis, after.emojis, (e) => ({ animated: e.animated, roles: e.roleRefs.length })),
    automod: diffCategory(before.automod, after.automod, (a) => ({
      enabled: a.enabled,
      triggerType: a.triggerType,
      actions: a.actions.length,
      exemptRoles: a.exemptRoleRefs.length,
      exemptChannels: a.exemptChannelRefs.length,
    })),
    overwriteChanges: computeOverwriteChanges(before, after),
    counts: {
      roles: { before: before.roles.length, after: after.roles.length },
      channels: { before: before.channels.length, after: after.channels.length },
      categories: { before: before.categories.length, after: after.categories.length },
      emojis: { before: before.emojis.length, after: after.emojis.length },
      automod: { before: before.automod.length, after: after.automod.length },
      bots: { before: before.bots.length, after: after.bots.length },
    },
  };

  // Decode role permission changes into added/revoked permission NAMES. Because `permissions` is no
  // longer a raw field above, a role whose ONLY change is its permission set won't be in `changed` yet —
  // so attach the delta to an existing entry, or push a permission-only entry (empty fields) for it.
  const changedRoleByName = new Map(diff.roles.changed.map((c) => [c.name, c]));
  for (const [name, r1] of afterRoles) {
    const r0 = beforeRoles.get(name);
    if (!r0 || r0.permissions === r1.permissions) continue;
    const delta = diffPermissions(r0.permissions, r1.permissions);
    if (delta.added.length === 0 && delta.removed.length === 0) continue;
    const existing = changedRoleByName.get(name);
    if (existing) existing.permissionDelta = delta;
    else {
      const entry: ChangedObject = { name, fields: [], permissionDelta: delta };
      diff.roles.changed.push(entry);
      changedRoleByName.set(name, entry);
    }
  }

  return diff;
}
