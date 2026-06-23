import { describe, expect, it } from 'vitest';
import { REBUILD_STEP_ORDER, SCHEMA_VERSION, Snapshot } from '../src/index.js';

/** A small but representative, valid snapshot input (pre-defaults). */
const sampleInput = {
  capturedAt: '2026-06-22T12:00:00.000Z',
  source: { guildId: '111111111111111111', name: 'Template HQ' },
  guild: {
    name: 'Template HQ',
    verificationLevel: 2,
    systemChannelRef: 'chan_welcome',
    rulesChannelRef: 'chan_rules',
    welcomeScreen: {
      enabled: true,
      description: 'Welcome to Template HQ',
      welcomeChannels: [{ channelRef: 'chan_rules', description: 'Read first' }],
    },
  },
  roles: [
    {
      localRef: 'role_everyone',
      name: '@everyone',
      isEveryone: true,
      colors: { primary: 0 },
      position: 0,
      permissions: '104324673',
    },
    {
      localRef: 'role_vip',
      name: 'VIP',
      colors: { primary: 0x7c3aed },
      hoist: true,
      position: 2,
      permissions: '0',
      mentionable: true,
    },
  ],
  categories: [{ localRef: 'cat_info', name: 'INFORMATION', position: 0 }],
  channels: [
    {
      localRef: 'chan_rules',
      kind: 'text',
      name: 'rules',
      categoryRef: 'cat_info',
      position: 0,
      topic: 'Server rules',
      copyPolicy: 'system_content',
      copyContent: true,
      overwrites: [{ targetType: 'role', targetRef: 'role_everyone', allow: '1024', deny: '2048' }],
    },
    {
      localRef: 'chan_welcome',
      kind: 'text',
      name: 'welcome',
      categoryRef: 'cat_info',
      position: 1,
      copyPolicy: 'system_content',
      copyContent: true,
    },
    {
      localRef: 'chan_general',
      kind: 'text',
      name: 'general',
      categoryRef: null,
      position: 2,
      copyPolicy: 'member_chat',
    },
  ],
  emojis: [{ localRef: 'emoji_logo', name: 'logo', asset: 'assets/abcdef12.png' }],
  brandTokens: [{ kind: 'name', value: 'Template HQ', occurrences: 2, sources: ['server name'] }],
};

describe('Snapshot schema', () => {
  it('parses a representative snapshot and applies defaults', () => {
    const snap = Snapshot.parse(sampleInput);
    expect(snap.schemaVersion).toBe(SCHEMA_VERSION);
    // arrays default to []
    expect(snap.automod).toEqual([]);
    expect(snap.bots).toEqual([]);
    expect(snap.content).toEqual([]);
    // nested defaults resolved
    expect(snap.roles[1]?.colors.secondary).toBeNull();
    expect(snap.channels[0]?.nsfw).toBe(false);
    expect(snap.channels[2]?.copyContent).toBe(false); // member_chat → off
  });

  it('preserves localRef cross-references (no raw ids in refs)', () => {
    const snap = Snapshot.parse(sampleInput);
    const rules = snap.channels.find((c) => c.localRef === 'chan_rules');
    expect(rules?.categoryRef).toBe('cat_info');
    expect(rules?.overwrites[0]?.targetRef).toBe('role_everyone');
    expect(snap.guild.systemChannelRef).toBe('chan_welcome');
    expect(snap.guild.welcomeScreen?.welcomeChannels[0]?.channelRef).toBe('chan_rules');
  });

  it('rejects malformed values', () => {
    expect(() =>
      Snapshot.parse({ ...sampleInput, guild: { ...sampleInput.guild, verificationLevel: 9 } }),
    ).toThrow();
    expect(() =>
      Snapshot.parse({
        ...sampleInput,
        roles: [{ localRef: 'r', name: 'x', colors: { primary: 0 }, position: 0, permissions: 'NaN' }],
      }),
    ).toThrow();
  });

  it('exposes the canonical dependency-ordered rebuild steps', () => {
    expect(REBUILD_STEP_ORDER[0]).toBe('guild_settings');
    expect(REBUILD_STEP_ORDER[5]).toBe('overwrites'); // overwrites after channels+roles
    expect(REBUILD_STEP_ORDER.indexOf('roles')).toBeLessThan(REBUILD_STEP_ORDER.indexOf('overwrites'));
    expect(REBUILD_STEP_ORDER.indexOf('channels')).toBeLessThan(REBUILD_STEP_ORDER.indexOf('pointers'));
  });
});
