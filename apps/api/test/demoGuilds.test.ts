import { Snapshot } from '@disco/schema';
import { describe, expect, it } from 'vitest';
import { demoGuildSnapshot, listDemoGuilds } from '../src/demoGuilds.js';

/**
 * The DEMO-mode guild list lets the operator exercise the import flow with no bot token: each entry
 * is backed by a fixture and re-stamped with its own name + guild id so it lands as a distinct
 * library entry. These cover the list shape, the re-stamping, the unknown-id null, and that the
 * produced snapshot is schema-valid (so the capture path downstream won't reject it).
 */
describe('demoGuilds', () => {
  it('listDemoGuilds returns 3 manageable servers', () => {
    const guilds = listDemoGuilds();
    expect(guilds).toHaveLength(3);
    for (const g of guilds) {
      expect(g.id).toMatch(/^\d+$/);
      expect(g.name.length).toBeGreaterThan(0);
      expect(g.iconUrl).toBeNull();
      expect(g.owner).toBe(false);
      expect(g.canManage).toBe(true);
    }
    // ids are distinct so each capture is a separate entry
    expect(new Set(guilds.map((g) => g.id)).size).toBe(3);
  });

  it('demoGuildSnapshot re-stamps name + guild id for a known id', () => {
    const guild = listDemoGuilds()[1]!; // 'Degen Den'
    const snap = demoGuildSnapshot(guild.id);
    expect(snap).not.toBeNull();
    expect(snap!.source.guildId).toBe(guild.id);
    expect(snap!.guild.name).toBe(guild.name);
  });

  it('returns null for an unknown guild id', () => {
    expect(demoGuildSnapshot('000000000000000000')).toBeNull();
  });

  it('produces a snapshot that passes Snapshot.parse for every demo guild', () => {
    for (const guild of listDemoGuilds()) {
      const snap = demoGuildSnapshot(guild.id);
      expect(snap).not.toBeNull();
      const parsed = Snapshot.parse(snap);
      expect(parsed.source.guildId).toBe(guild.id);
      expect(parsed.guild.name).toBe(guild.name);
    }
  });
});
