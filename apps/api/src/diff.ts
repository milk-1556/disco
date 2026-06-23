import type { Snapshot } from '@disco/schema';

export interface FieldChange {
  field: string;
  before: string;
  after: string;
}
export interface ChangedObject {
  name: string;
  fields: FieldChange[];
}
export interface CategoryDiff {
  added: string[];
  removed: string[];
  changed: ChangedObject[];
}
export interface SnapshotDiff {
  guildNameChanged: { before: string; after: string } | null;
  roles: CategoryDiff;
  channels: CategoryDiff;
  emojis: CategoryDiff;
  automod: CategoryDiff;
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

/** Structural + per-field diff between two snapshot versions (drives the library diff view, §3). */
export function diffSnapshots(before: Snapshot, after: Snapshot): SnapshotDiff {
  return {
    guildNameChanged: before.guild.name !== after.guild.name ? { before: before.guild.name, after: after.guild.name } : null,
    roles: diffCategory(before.roles, after.roles, (r) => ({
      color: `#${r.colors.primary.toString(16).padStart(6, '0')}`,
      permissions: r.permissions,
      hoist: r.hoist,
      mentionable: r.mentionable,
      position: r.position,
    })),
    channels: diffCategory(before.channels, after.channels, (c) => ({
      topic: c.topic,
      nsfw: c.nsfw,
      slowmode: c.rateLimitPerUser,
      copyPolicy: c.copyPolicy,
      overwrites: c.overwrites.map((o) => `${o.targetRef}:${o.allow}/${o.deny}`).sort(),
    })),
    emojis: diffCategory(before.emojis, after.emojis, (e) => ({ animated: e.animated, roles: e.roleRefs.length })),
    automod: diffCategory(before.automod, after.automod, (a) => ({
      enabled: a.enabled,
      triggerType: a.triggerType,
      actions: a.actions.length,
      exemptRoles: a.exemptRoleRefs.length,
      exemptChannels: a.exemptChannelRefs.length,
    })),
    counts: {
      roles: { before: before.roles.length, after: after.roles.length },
      channels: { before: before.channels.length, after: after.channels.length },
      categories: { before: before.categories.length, after: after.categories.length },
      emojis: { before: before.emojis.length, after: after.emojis.length },
      automod: { before: before.automod.length, after: after.automod.length },
      bots: { before: before.bots.length, after: after.bots.length },
    },
  };
}
