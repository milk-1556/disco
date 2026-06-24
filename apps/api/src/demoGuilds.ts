import { makeProductionTraceSnapshot, makeSampleSnapshot } from '@disco/core';
import type { Snapshot } from '@disco/schema';
import type { JoinedGuild } from '@disco/sdk';

/**
 * In DEMO mode (no bot token) the "bot" is treated as a member of these realistic servers, so the
 * operator can exercise the whole import flow — pick a server → capture → it lands in the library —
 * without a real Discord connection. Each is backed by a fixture and re-stamped with its own name +
 * guild id so capturing it adds a distinct library entry. In LIVE mode this list is replaced by the
 * bot's actual joined guilds (listJoinedGuilds).
 */
const DEMO_GUILDS: { id: string; name: string; make: () => Snapshot }[] = [
  { id: '900000000000000101', name: 'Stakehaus | Slots & Casino', make: makeProductionTraceSnapshot },
  { id: '900000000000000102', name: 'Degen Den', make: makeProductionTraceSnapshot },
  { id: '900000000000000103', name: 'VIP Slots Lounge', make: makeSampleSnapshot },
];

export function listDemoGuilds(): JoinedGuild[] {
  return DEMO_GUILDS.map((g) => ({ id: g.id, name: g.name, iconUrl: null, owner: false, canManage: true }));
}

/** Produce the source snapshot for a demo guild id (re-stamped name + id), or null if unknown. */
export function demoGuildSnapshot(guildId: string): Snapshot | null {
  const g = DEMO_GUILDS.find((x) => x.id === guildId);
  if (!g) return null;
  const snap = g.make();
  snap.source = { ...snap.source, guildId: g.id };
  snap.guild = { ...snap.guild, name: g.name };
  return snap;
}
