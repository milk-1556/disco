import type { Snapshot } from '@disco/schema';

export interface SnapshotDiff {
  guildNameChanged: { before: string; after: string } | null;
  roles: { added: string[]; removed: string[] };
  channels: { added: string[]; removed: string[] };
  emojis: { added: string[]; removed: string[] };
  counts: Record<string, { before: number; after: number }>;
}

const names = (xs: { name: string }[]) => new Set(xs.map((x) => x.name));
const diffNames = (a: { name: string }[], b: { name: string }[]) => {
  const sa = names(a);
  const sb = names(b);
  return {
    added: [...sb].filter((n) => !sa.has(n)),
    removed: [...sa].filter((n) => !sb.has(n)),
  };
};

/** Lightweight structural diff between two snapshot versions (drives the library diff view, §3). */
export function diffSnapshots(before: Snapshot, after: Snapshot): SnapshotDiff {
  return {
    guildNameChanged: before.guild.name !== after.guild.name ? { before: before.guild.name, after: after.guild.name } : null,
    roles: diffNames(before.roles, after.roles),
    channels: diffNames(before.channels, after.channels),
    emojis: diffNames(before.emojis, after.emojis),
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
