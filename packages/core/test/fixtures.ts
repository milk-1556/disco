import { RebrandConfig, Snapshot } from '@disco/schema';

/**
 * A representative "template server" snapshot used across core tests and (later) as the seed for the
 * in-memory MockGuild. Branded for creator "Acme" with purple #7C3AED and a Whop link — exactly the
 * kind of thing the rebrand engine must transform for a new client.
 */
export function makeSampleSnapshot(): Snapshot {
  return Snapshot.parse({
    capturedAt: '2026-06-22T12:00:00.000Z',
    source: { guildId: '111111111111111111', name: 'Acme Slots HQ' },
    guild: {
      name: 'Acme Slots HQ',
      verificationLevel: 2,
      explicitContentFilter: 2,
      premiumTier: 2,
      systemChannelRef: 'chan_welcome',
      rulesChannelRef: 'chan_rules',
      publicUpdatesChannelRef: 'chan_announce',
      assets: { icon: 'assets/aaaa1111.png', banner: 'assets/bbbb2222.png' },
      welcomeScreen: {
        enabled: true,
        description: 'Welcome to Acme Slots HQ — grab your roles!',
        welcomeChannels: [
          { channelRef: 'chan_rules', description: 'Read the Acme rules' },
          { channelRef: 'chan_roleselect', description: 'Pick your roles' },
        ],
      },
    },
    roles: [
      { localRef: 'role_everyone', name: '@everyone', isEveryone: true, colors: { primary: 0 }, position: 0, permissions: '104324673' },
      { localRef: 'role_vip', name: 'Acme VIP', colors: { primary: 0x7c3aed }, hoist: true, position: 3, permissions: '0', mentionable: true },
      { localRef: 'role_mod', name: 'Acme Mod', colors: { primary: 0x2ecc71 }, hoist: true, position: 2, permissions: '8' },
      { localRef: 'role_mee6', name: 'MEE6', colors: { primary: 0 }, position: 1, permissions: '8', managed: true, tags: { botId: '159985870458322944' } },
    ],
    categories: [
      { localRef: 'cat_info', name: 'INFORMATION', position: 0 },
      { localRef: 'cat_chat', name: 'ACME CHAT', position: 1 },
    ],
    channels: [
      {
        localRef: 'chan_rules', kind: 'text', name: 'rules', categoryRef: 'cat_info', position: 0,
        topic: 'Acme Slots rules. Join https://whop.com/acme-vip for perks.',
        copyPolicy: 'member_chat',
        overwrites: [{ targetType: 'role', targetRef: 'role_everyone', allow: '1024', deny: '2048' }],
      },
      { localRef: 'chan_welcome', kind: 'text', name: 'welcome', categoryRef: 'cat_info', position: 1, copyPolicy: 'member_chat' },
      { localRef: 'chan_announce', kind: 'announcement', name: 'announcements', categoryRef: 'cat_info', position: 2, copyPolicy: 'member_chat' },
      { localRef: 'chan_roleselect', kind: 'text', name: 'role-select', categoryRef: 'cat_info', position: 3, copyPolicy: 'member_chat' },
      {
        localRef: 'chan_secret', kind: 'text', name: 'mods-only', categoryRef: 'cat_info', position: 4,
        copyPolicy: 'member_chat',
        overwrites: [
          { targetType: 'role', targetRef: 'role_everyone', allow: '0', deny: '2048' },
          { targetType: 'member', targetRef: 'member_oldowner', allow: '8', deny: '0' },
        ],
      },
      { localRef: 'chan_general', kind: 'text', name: 'general', categoryRef: 'cat_chat', position: 0, copyPolicy: 'member_chat' },
      { localRef: 'chan_lounge', kind: 'voice', name: 'Acme Lounge', categoryRef: 'cat_chat', position: 1, bitrate: 64000, userLimit: 10, copyPolicy: 'member_chat' },
    ],
    emojis: [{ localRef: 'emoji_coin', name: 'acmecoin', asset: 'assets/cccc3333.png' }],
    stickers: [],
    automod: [
      { localRef: 'am_links', name: 'Acme link filter', triggerType: 4, triggerMetadata: { presets: [1] }, actions: [{ type: 1 }], exemptRoleRefs: ['role_mod'] },
    ],
    bots: [
      {
        localRef: 'bot_mee6', sourceId: '159985870458322944', name: 'MEE6', vendorGuess: 'MEE6',
        inviteUrl: 'https://mee6.xyz/add',
        reconfigureNotes: ['welcome messages', 'reaction roles', 'leveling'],
        configTraces: [{ kind: 'managed_role', where: 'role: MEE6', ref: 'role_mee6', detail: null }],
      },
    ],
    content: [
      {
        channelRef: 'chan_rules',
        hasInteractiveComponents: false,
        messages: [
          {
            authorName: 'Acme', authorIsBot: false, pinned: true,
            content: 'Read the Acme Slots rules below.',
            embeds: [
              {
                title: 'Acme Slots Rules', color: 0x7c3aed,
                description: 'Be cool. Visit https://whop.com/acme-vip to upgrade.',
                fields: [{ name: 'Rule 1', value: 'Respect the Acme team.', inline: false }],
              },
            ],
          },
        ],
      },
      {
        channelRef: 'chan_roleselect',
        hasInteractiveComponents: true,
        messages: [
          { authorName: 'MEE6', authorIsBot: true, content: 'React to pick your Acme roles.', componentSummary: ['button: VIP'], embeds: [] },
        ],
      },
    ],
    brandTokens: [
      { kind: 'name', value: 'Acme', occurrences: 9, sources: ['server name', 'role: Acme VIP'] },
      { kind: 'color', value: '#7c3aed', occurrences: 2, sources: ['role: Acme VIP'] },
      { kind: 'url', value: 'https://whop.com/acme-vip', occurrences: 2, sources: ['#rules topic'] },
    ],
  });
}

/** A standard rebrand: Acme → Nova, purple → rose, old Whop link → new. */
export function makeSampleConfig() {
  return RebrandConfig.parse({
    clientId: 'client_nova',
    serverName: 'Nova Slots HQ',
    findReplace: [{ from: 'Acme', to: 'Nova', caseInsensitive: true, wholeWordSmart: true }],
    colorMap: [{ from: '#7C3AED', to: '#E11D48' }],
    linkMap: [{ from: 'https://whop.com/acme-vip', to: 'https://whop.com/nova-vip' }],
    assets: {},
  });
}
