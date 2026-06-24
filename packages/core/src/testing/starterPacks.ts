import { Snapshot } from '@disco/schema';

/**
 * Curated, SELLABLE starter-pack template snapshots Max can offer clients out of the box.
 *
 * Each pack is a complete, realistic {@link Snapshot} (the same shape as
 * {@link makeProductionTraceSnapshot}) tuned for a specific creator niche, so a client can pick a
 * pack, rebrand it, and ship a polished server in one build. The three packs are DISTINCT in
 * structure — different categories, channels, and roles fitting their niche — not three clones of
 * one layout. All cross-references use internal localRefs only, and every snapshot is kept well
 * under tier-0 Discord limits (no banner/splash, ≤5 stickers, modest emoji counts) so the build
 * succeeds on a brand-new server.
 *
 * Pass each through `Snapshot.parse` at construction time so a malformed pack fails loudly.
 */
export interface StarterPack {
  key: string;
  title: string;
  pitch: string;
  niche: string;
  snapshot: Snapshot;
}

/** All curated starter packs, ready for seeding / the templates library UI. */
export function makeStarterPacks(): StarterPack[] {
  return [slotsCommunityPack(), irlVloggerPack(), casinoSponsorPack()];
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 1. SLOTS COMMUNITY PACK — casino/slots creator
//    6 categories · 18 channels · 10 roles
//    Focus: #bonus-hunts, #big-wins, #slot-calls, VIP tiers, a giveaways category.
// ════════════════════════════════════════════════════════════════════════════════════════════════
function slotsCommunityPack(): StarterPack {
  return {
    key: 'slots',
    title: 'Slots Community Pack',
    pitch:
      'A bonus-hunting slots community ready to go: live bonus-hunt tracking, a tagged big-wins forum, slot-call requests, and gated VIP/Whale lounges. Perfect for a casino-stream creator launching their Discord.',
    niche: 'Casino / slots creator',
    snapshot: Snapshot.parse({
      capturedAt: '2026-06-23T12:00:00.000Z',
      source: {
        guildId: '000000000000000100',
        name: 'Reelhouse | Slots Community',
        ownerNote: 'Starter template — slots/casino streamer community with bonus hunts + VIP tiers.',
      },
      guild: {
        name: 'Reelhouse | Slots Community',
        verificationLevel: 2,
        defaultMessageNotifications: 1,
        explicitContentFilter: 2,
        afkChannelRef: 'chan_afk',
        afkTimeout: 900,
        systemChannelRef: 'chan_welcome',
        systemChannelFlags: 4,
        rulesChannelRef: 'chan_rules',
        publicUpdatesChannelRef: 'chan_announcements',
        preferredLocale: 'en-US',
        premiumTier: 0,
        assets: { icon: 'assets/100aa11bb2cc33dd.png' },
        welcomeScreen: {
          enabled: true,
          description: 'Welcome to Reelhouse — grab your roles and start hunting bonuses.',
          welcomeChannels: [
            { channelRef: 'chan_rules', description: 'Read the rules first', emojiUnicode: '📜' },
            { channelRef: 'chan_role_select', description: 'Pick your roles', emojiUnicode: '🎭' },
            { channelRef: 'chan_bonus_hunts', description: 'Live bonus hunts', emojiRef: 'emoji_reel' },
            { channelRef: 'chan_big_wins', description: 'Post your big wins', emojiRef: 'emoji_jackpot' },
          ],
        },
      },
      roles: [
        { localRef: 'role_everyone', sourceId: '000000000000000100', name: '@everyone', isEveryone: true, colors: { primary: 0 }, position: 0, permissions: '104324673' },
        { localRef: 'role_owner', name: 'Owner', colors: { primary: 0xb91c1c }, hoist: true, position: 9, permissions: '1099511627775', mentionable: false },
        { localRef: 'role_admin', name: 'Admin', colors: { primary: 0xef4444 }, hoist: true, position: 8, permissions: '8', mentionable: true },
        { localRef: 'role_mod', name: 'Moderator', colors: { primary: 0xf59e0b }, hoist: true, position: 7, permissions: '1290157103', mentionable: true },
        { localRef: 'role_whale', name: 'Whale 🐋', colors: { primary: 0xfacc15, secondary: 0xb91c1c }, hoist: true, position: 6, permissions: '0', mentionable: true, unicodeEmoji: '🐋' },
        { localRef: 'role_vip', name: 'Reelhouse VIP', colors: { primary: 0xb91c1c }, hoist: true, position: 5, permissions: '0', mentionable: true },
        { localRef: 'role_booster', name: 'Server Booster', colors: { primary: 0xf47fff }, hoist: false, position: 4, permissions: '0', mentionable: false, tags: { premiumSubscriber: true } },
        { localRef: 'role_winner', name: 'Big Winner', colors: { primary: 0xfb923c }, hoist: false, position: 3, permissions: '0', mentionable: true },
        { localRef: 'role_member', name: 'Member', colors: { primary: 0 }, hoist: false, position: 2, permissions: '0', mentionable: false },
        { localRef: 'role_giveaway', name: 'Giveaway Ping', colors: { primary: 0x22c55e }, hoist: false, position: 1, permissions: '0', mentionable: true },
      ],
      categories: [
        { localRef: 'cat_welcome', name: 'WELCOME', position: 0 },
        { localRef: 'cat_information', name: 'INFORMATION', position: 1 },
        { localRef: 'cat_community', name: 'COMMUNITY', position: 2 },
        { localRef: 'cat_slots', name: 'SLOTS', position: 3 },
        {
          localRef: 'cat_giveaways',
          name: 'GIVEAWAYS',
          position: 4,
          overwrites: [{ targetType: 'role', targetRef: 'role_everyone', allow: '1024', deny: '2048' }],
        },
        {
          localRef: 'cat_vip',
          name: 'VIP LOUNGE',
          position: 5,
          overwrites: [
            { targetType: 'role', targetRef: 'role_everyone', allow: '0', deny: '1024' },
            { targetType: 'role', targetRef: 'role_vip', allow: '1024', deny: '0' },
            { targetType: 'role', targetRef: 'role_whale', allow: '1024', deny: '0' },
          ],
        },
      ],
      channels: [
        // WELCOME
        { localRef: 'chan_welcome', kind: 'text', name: 'welcome', categoryRef: 'cat_welcome', position: 0, topic: 'New here? Start in #rules then grab roles.', copyPolicy: 'system_content', copyContent: true, overwrites: [{ targetType: 'role', targetRef: 'role_everyone', allow: '1024', deny: '2048' }] },
        { localRef: 'chan_rules', kind: 'text', name: 'rules', categoryRef: 'cat_welcome', position: 1, topic: 'Community rules. 18+ only. Gamble responsibly.', copyPolicy: 'system_content', copyContent: true, overwrites: [{ targetType: 'role', targetRef: 'role_everyone', allow: '1024', deny: '2048' }] },
        { localRef: 'chan_role_select', kind: 'text', name: 'role-select', categoryRef: 'cat_welcome', position: 2, topic: 'Click to pick your roles.', copyPolicy: 'system_content', copyContent: true, overwrites: [{ targetType: 'role', targetRef: 'role_everyone', allow: '1024', deny: '2048' }] },
        // INFORMATION
        { localRef: 'chan_announcements', kind: 'announcement', name: 'announcements', categoryRef: 'cat_information', position: 0, topic: 'Official drops, giveaways & schedule.', copyPolicy: 'system_content', copyContent: true, overwrites: [{ targetType: 'role', targetRef: 'role_everyone', allow: '0', deny: '2048' }, { targetType: 'role', targetRef: 'role_admin', allow: '2048', deny: '0' }] },
        { localRef: 'chan_links', kind: 'text', name: 'links', categoryRef: 'cat_information', position: 1, topic: 'All official links — beware impersonators.', copyPolicy: 'system_content', copyContent: true },
        { localRef: 'chan_mod_log', kind: 'text', name: 'mod-log', categoryRef: 'cat_information', position: 2, topic: 'AutoMod alerts & moderation log.', copyPolicy: 'member_chat', overwrites: [{ targetType: 'role', targetRef: 'role_everyone', allow: '0', deny: '1024' }, { targetType: 'role', targetRef: 'role_mod', allow: '1024', deny: '0' }] },
        // COMMUNITY
        { localRef: 'chan_general', kind: 'text', name: 'general', categoryRef: 'cat_community', position: 0, topic: 'General chat. Keep it friendly.', rateLimitPerUser: 3, copyPolicy: 'member_chat' },
        { localRef: 'chan_clips', kind: 'text', name: 'clips', categoryRef: 'cat_community', position: 1, topic: 'Drop your stream clips & highlights.', copyPolicy: 'member_chat' },
        { localRef: 'chan_memes', kind: 'text', name: 'memes', categoryRef: 'cat_community', position: 2, topic: 'Post your dankest slot memes.', copyPolicy: 'member_chat' },
        // SLOTS
        { localRef: 'chan_strategy', kind: 'text', name: 'strategy', categoryRef: 'cat_slots', position: 0, topic: 'Bankroll management & bonus-hunting strategy.', copyPolicy: 'member_chat' },
        { localRef: 'chan_bonus_hunts', kind: 'text', name: 'bonus-hunts', categoryRef: 'cat_slots', position: 1, topic: 'Live bonus-hunt tracking. Staff post the opener list.', copyPolicy: 'system_content', copyContent: true, overwrites: [{ targetType: 'role', targetRef: 'role_everyone', allow: '0', deny: '2048' }, { targetType: 'role', targetRef: 'role_mod', allow: '2048', deny: '0' }] },
        { localRef: 'chan_slot_calls', kind: 'text', name: 'slot-calls', categoryRef: 'cat_slots', position: 2, topic: 'Call a slot for the next bonus-buy stream.', rateLimitPerUser: 10, copyPolicy: 'member_chat' },
        {
          localRef: 'chan_big_wins', kind: 'forum', name: 'big-wins', categoryRef: 'cat_slots', position: 3,
          topic: 'Post your monster wins. Use tags. Screenshots required.',
          rateLimitPerUser: 0, defaultForumLayout: 2, defaultSortOrder: 0, defaultAutoArchiveDuration: 4320, defaultThreadRateLimitPerUser: 5,
          defaultReaction: { emojiRef: 'emoji_jackpot' }, copyPolicy: 'member_chat',
          forumTags: [
            { localRef: 'tag_10x', name: '10x-100x', moderated: false, emojiUnicode: '✨' },
            { localRef: 'tag_100x', name: '100x-500x', moderated: false, emojiUnicode: '🔥' },
            { localRef: 'tag_500x', name: '500x+', moderated: false, emojiRef: 'emoji_jackpot' },
          ],
        },
        // GIVEAWAYS
        { localRef: 'chan_giveaways', kind: 'text', name: 'giveaways', categoryRef: 'cat_giveaways', position: 0, topic: 'Active giveaways. React to enter.', copyPolicy: 'system_content', copyContent: true, overwrites: [{ targetType: 'role', targetRef: 'role_everyone', allow: '0', deny: '2048' }, { targetType: 'role', targetRef: 'role_mod', allow: '2048', deny: '0' }] },
        { localRef: 'chan_winners', kind: 'text', name: 'winners', categoryRef: 'cat_giveaways', position: 1, topic: 'Past giveaway winners. Congrats!', copyPolicy: 'member_chat' },
        // VIP LOUNGE
        { localRef: 'chan_vip_chat', kind: 'text', name: 'vip-chat', categoryRef: 'cat_vip', position: 0, topic: 'VIP & Whale only lounge.', copyPolicy: 'member_chat', overwrites: [{ targetType: 'role', targetRef: 'role_everyone', allow: '0', deny: '1024' }, { targetType: 'role', targetRef: 'role_vip', allow: '1024', deny: '0' }] },
        // VOICE (afk lives loose under no category, referenced by guild.afkChannelRef)
        { localRef: 'chan_afk', kind: 'voice', name: 'AFK', position: 6, bitrate: 64000, userLimit: 0, copyPolicy: 'member_chat' },
      ],
      emojis: [
        { localRef: 'emoji_jackpot', name: 'jackpot', asset: 'assets/1aa11bb22cc33d01.png' },
        { localRef: 'emoji_reel', name: 'reel', asset: 'assets/1aa11bb22cc33d02.png' },
        { localRef: 'emoji_coin', name: 'coin', asset: 'assets/1aa11bb22cc33d03.png' },
        { localRef: 'emoji_fire', name: 'onfire', asset: 'assets/1aa11bb22cc33d04.gif', animated: true },
      ],
      stickers: [
        { localRef: 'sticker_bigwin', name: 'BIG WIN', description: 'Big-win celebration sticker', tags: '🎰', asset: 'assets/1aa11bb22cc33d05.png', formatType: 1 },
      ],
      automod: [
        {
          localRef: 'am_scam_links', name: 'Block scam & impersonator links', eventType: 1, triggerType: 1,
          triggerMetadata: { keywordFilter: ['free*nitro', 'discordgift*'], allowList: [] },
          actions: [{ type: 1, customMessage: 'Blocked: suspected scam link. Only trust links in #links.' }, { type: 2, alertChannelRef: 'chan_mod_log' }],
          enabled: true, exemptRoleRefs: ['role_admin', 'role_mod'], exemptChannelRefs: ['chan_links'],
        },
        {
          localRef: 'am_spam', name: 'Spam content filter', eventType: 1, triggerType: 3, triggerMetadata: {},
          actions: [{ type: 1, customMessage: 'Please slow down — that looked like spam.' }],
          enabled: true, exemptRoleRefs: ['role_admin', 'role_mod'],
        },
      ],
      bots: [
        {
          localRef: 'bot_mee6', sourceId: '159985870458322944', name: 'MEE6', vendorGuess: 'MEE6', inviteUrl: 'https://mee6.xyz/add',
          reconfigureNotes: ['leveling + rank roles', 'reaction roles in #role-select', 'welcome messages in #welcome'],
          configTraces: [{ kind: 'permission_overwrite', where: '#role-select overwrite', ref: 'chan_role_select', detail: 'reaction-role message' }],
        },
      ],
      content: [
        {
          channelRef: 'chan_rules', hasInteractiveComponents: false,
          messages: [{
            authorName: 'Reelhouse', authorIsBot: false, pinned: true,
            content: 'Welcome to **Reelhouse**. By staying here you agree to the rules below. 18+ only — gamble responsibly.',
            embeds: [{
              title: 'Reelhouse Rules', color: 0xb91c1c, description: 'Be respectful. No scams, no shilling, no begging.',
              footerText: 'Reelhouse | Slots Community',
              fields: [
                { name: '1. Respect everyone', value: 'No harassment, hate speech, or witch-hunting.', inline: false },
                { name: '2. No advertising', value: 'No unsolicited links, DMs, or self-promo.', inline: false },
                { name: '3. 18+ only', value: 'This is a gambling community. Must be of legal age.', inline: false },
                { name: '4. Gamble responsibly', value: 'Never bet more than you can afford to lose.', inline: false },
              ],
            }],
          }],
        },
        {
          channelRef: 'chan_welcome', hasInteractiveComponents: false,
          messages: [{
            authorName: 'Reelhouse', authorIsBot: false, pinned: true, content: 'Glad to have you in the house.',
            embeds: [{
              title: 'Welcome to Reelhouse 🎰', color: 0xb91c1c,
              description: 'Pick up your roles in #role-select, then jump into #general. Big wins go in #big-wins.',
              fields: [
                { name: 'Start here', value: 'Read #rules → grab roles in #role-select.', inline: true },
                { name: 'Track hunts', value: 'Live bonus hunts in #bonus-hunts.', inline: true },
              ],
            }],
          }],
        },
        {
          channelRef: 'chan_role_select', hasInteractiveComponents: true,
          messages: [{
            authorName: 'MEE6', authorIsBot: true, pinned: true,
            content: 'Pick your roles below to customize your Reelhouse experience.',
            embeds: [{ title: 'Self-Assign Roles', color: 0xb91c1c, description: 'Click a button to toggle a role.' }],
            componentSummary: ['button: 🔔 Drops Ping', 'button: 🎁 Giveaway Ping', 'button: 🏆 Big Winner'],
          }],
        },
      ],
      brandTokens: [
        { kind: 'name', value: 'Reelhouse', occurrences: 9, sources: ['server name', 'role: Reelhouse VIP', '#rules embed', '#welcome embed'] },
        { kind: 'color', value: '#b91c1c', occurrences: 7, sources: ['role: Owner', 'role: Reelhouse VIP', 'category: VIP LOUNGE', '#rules embed', '#welcome embed'] },
      ],
    }),
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 2. IRL VLOGGER PACK — travel/IRL streamer
//    6 categories · 19 channels · 9 roles
//    Focus: #stream-announcements, #clips, #meetups, location-based channels, supporter tiers.
// ════════════════════════════════════════════════════════════════════════════════════════════════
function irlVloggerPack(): StarterPack {
  return {
    key: 'irl',
    title: 'IRL Vlogger Pack',
    pitch:
      'Built for a travel/IRL streamer: stream-announcement pings, a clips reel, region-based hangouts (NA/EU/Asia), real-life meetups, and supporter tiers. Drop in your brand and go live.',
    niche: 'Travel / IRL streamer',
    snapshot: Snapshot.parse({
      capturedAt: '2026-06-23T12:00:00.000Z',
      source: {
        guildId: '000000000000000200',
        name: 'Wander | IRL Travel',
        ownerNote: 'Starter template — IRL/travel streamer with location channels + supporter tiers.',
      },
      guild: {
        name: 'Wander | IRL Travel',
        verificationLevel: 2,
        defaultMessageNotifications: 1,
        explicitContentFilter: 1,
        afkChannelRef: 'chan_afk',
        afkTimeout: 900,
        systemChannelRef: 'chan_welcome',
        systemChannelFlags: 4,
        rulesChannelRef: 'chan_rules',
        publicUpdatesChannelRef: 'chan_stream_announcements',
        preferredLocale: 'en-US',
        premiumTier: 0,
        assets: { icon: 'assets/200cc11dd2ee33ff.png' },
        welcomeScreen: {
          enabled: true,
          description: 'Welcome to Wander — pick your region and never miss a stream.',
          welcomeChannels: [
            { channelRef: 'chan_rules', description: 'Read the rules first', emojiUnicode: '📜' },
            { channelRef: 'chan_role_select', description: 'Pick region + pings', emojiUnicode: '🌍' },
            { channelRef: 'chan_stream_announcements', description: 'When we go live', emojiUnicode: '🔴' },
            { channelRef: 'chan_meetups', description: 'Meet up IRL', emojiRef: 'emoji_pin' },
          ],
        },
      },
      roles: [
        { localRef: 'role_everyone', sourceId: '000000000000000200', name: '@everyone', isEveryone: true, colors: { primary: 0 }, position: 0, permissions: '104324673' },
        { localRef: 'role_creator', name: 'Wander', colors: { primary: 0x0ea5e9 }, hoist: true, position: 8, permissions: '1099511627775', mentionable: false },
        { localRef: 'role_mod', name: 'Moderator', colors: { primary: 0x14b8a6 }, hoist: true, position: 7, permissions: '1290157103', mentionable: true },
        { localRef: 'role_editor', name: 'Editor', colors: { primary: 0xa855f7 }, hoist: true, position: 6, permissions: '0', mentionable: true },
        { localRef: 'role_patron', name: 'Patron 🌟', colors: { primary: 0xf59e0b, secondary: 0x0ea5e9 }, hoist: true, position: 5, permissions: '0', mentionable: true, unicodeEmoji: '🌟' },
        { localRef: 'role_supporter', name: 'Supporter', colors: { primary: 0x0ea5e9 }, hoist: true, position: 4, permissions: '0', mentionable: true },
        { localRef: 'role_booster', name: 'Server Booster', colors: { primary: 0xf47fff }, hoist: false, position: 3, permissions: '0', mentionable: false, tags: { premiumSubscriber: true } },
        { localRef: 'role_live_ping', name: 'Live Ping', colors: { primary: 0xef4444 }, hoist: false, position: 2, permissions: '0', mentionable: true },
        { localRef: 'role_member', name: 'Traveler', colors: { primary: 0 }, hoist: false, position: 1, permissions: '0', mentionable: false },
      ],
      categories: [
        { localRef: 'cat_welcome', name: 'WELCOME', position: 0 },
        { localRef: 'cat_stream', name: 'STREAM', position: 1 },
        { localRef: 'cat_community', name: 'COMMUNITY', position: 2 },
        { localRef: 'cat_regions', name: 'REGIONS', position: 3 },
        { localRef: 'cat_irl', name: 'IRL & MEETUPS', position: 4 },
        {
          localRef: 'cat_supporters',
          name: 'SUPPORTERS',
          position: 5,
          overwrites: [
            { targetType: 'role', targetRef: 'role_everyone', allow: '0', deny: '1024' },
            { targetType: 'role', targetRef: 'role_supporter', allow: '1024', deny: '0' },
            { targetType: 'role', targetRef: 'role_patron', allow: '1024', deny: '0' },
          ],
        },
      ],
      channels: [
        // WELCOME
        { localRef: 'chan_welcome', kind: 'text', name: 'welcome', categoryRef: 'cat_welcome', position: 0, topic: 'New here? Start in #rules then pick your region.', copyPolicy: 'system_content', copyContent: true, overwrites: [{ targetType: 'role', targetRef: 'role_everyone', allow: '1024', deny: '2048' }] },
        { localRef: 'chan_rules', kind: 'text', name: 'rules', categoryRef: 'cat_welcome', position: 1, topic: 'Community rules. Be kind, no doxxing of locations.', copyPolicy: 'system_content', copyContent: true, overwrites: [{ targetType: 'role', targetRef: 'role_everyone', allow: '1024', deny: '2048' }] },
        { localRef: 'chan_role_select', kind: 'text', name: 'role-select', categoryRef: 'cat_welcome', position: 2, topic: 'Pick your region & ping roles.', copyPolicy: 'system_content', copyContent: true, overwrites: [{ targetType: 'role', targetRef: 'role_everyone', allow: '1024', deny: '2048' }] },
        // STREAM
        { localRef: 'chan_stream_announcements', kind: 'announcement', name: 'stream-announcements', categoryRef: 'cat_stream', position: 0, topic: 'When we go live + the travel schedule.', copyPolicy: 'system_content', copyContent: true, overwrites: [{ targetType: 'role', targetRef: 'role_everyone', allow: '0', deny: '2048' }, { targetType: 'role', targetRef: 'role_mod', allow: '2048', deny: '0' }] },
        { localRef: 'chan_clips', kind: 'text', name: 'clips', categoryRef: 'cat_stream', position: 1, topic: 'Best stream clips & highlight reels.', copyPolicy: 'member_chat' },
        { localRef: 'chan_vods', kind: 'text', name: 'vods', categoryRef: 'cat_stream', position: 2, topic: 'Full VOD links by date & city.', copyPolicy: 'member_chat' },
        // COMMUNITY
        { localRef: 'chan_general', kind: 'text', name: 'general', categoryRef: 'cat_community', position: 0, topic: 'General chat. Keep it friendly.', rateLimitPerUser: 3, copyPolicy: 'member_chat' },
        { localRef: 'chan_photos', kind: 'text', name: 'photo-dump', categoryRef: 'cat_community', position: 1, topic: 'Share your own travel photos.', copyPolicy: 'member_chat' },
        { localRef: 'chan_recommendations', kind: 'text', name: 'recommendations', categoryRef: 'cat_community', position: 2, topic: 'Food, spots & hidden gems worth visiting.', copyPolicy: 'member_chat' },
        { localRef: 'chan_off_topic', kind: 'text', name: 'off-topic', categoryRef: 'cat_community', position: 3, topic: 'Anything goes (within the rules).', copyPolicy: 'member_chat' },
        // REGIONS
        { localRef: 'chan_na', kind: 'text', name: 'north-america', categoryRef: 'cat_regions', position: 0, topic: 'NA travelers — meet your locals.', copyPolicy: 'member_chat' },
        { localRef: 'chan_eu', kind: 'text', name: 'europe', categoryRef: 'cat_regions', position: 1, topic: 'EU travelers — meet your locals.', copyPolicy: 'member_chat' },
        { localRef: 'chan_asia', kind: 'text', name: 'asia-pacific', categoryRef: 'cat_regions', position: 2, topic: 'APAC travelers — meet your locals.', copyPolicy: 'member_chat' },
        // IRL & MEETUPS
        { localRef: 'chan_meetups', kind: 'text', name: 'meetups', categoryRef: 'cat_irl', position: 0, topic: 'Organize & announce real-life meetups. Stay safe.', copyPolicy: 'member_chat' },
        { localRef: 'chan_safety', kind: 'text', name: 'safety', categoryRef: 'cat_irl', position: 1, topic: 'Meetup safety guidelines — read before attending.', copyPolicy: 'system_content', copyContent: true, overwrites: [{ targetType: 'role', targetRef: 'role_everyone', allow: '0', deny: '2048' }, { targetType: 'role', targetRef: 'role_mod', allow: '2048', deny: '0' }] },
        // SUPPORTERS
        { localRef: 'chan_supporter_chat', kind: 'text', name: 'supporter-chat', categoryRef: 'cat_supporters', position: 0, topic: 'Supporters & Patrons only lounge.', copyPolicy: 'member_chat', overwrites: [{ targetType: 'role', targetRef: 'role_everyone', allow: '0', deny: '1024' }, { targetType: 'role', targetRef: 'role_supporter', allow: '1024', deny: '0' }] },
        { localRef: 'chan_behind_scenes', kind: 'text', name: 'behind-the-scenes', categoryRef: 'cat_supporters', position: 1, topic: 'Patron-exclusive BTS & raw footage.', copyPolicy: 'member_chat', overwrites: [{ targetType: 'role', targetRef: 'role_everyone', allow: '0', deny: '1024' }, { targetType: 'role', targetRef: 'role_patron', allow: '1024', deny: '0' }] },
        // VOICE
        { localRef: 'chan_voice_lounge', kind: 'voice', name: 'Hangout', position: 6, bitrate: 96000, userLimit: 20, rtcRegion: null, videoQualityMode: 1, copyPolicy: 'member_chat' },
        { localRef: 'chan_afk', kind: 'voice', name: 'AFK', position: 7, bitrate: 64000, userLimit: 0, copyPolicy: 'member_chat' },
      ],
      emojis: [
        { localRef: 'emoji_pin', name: 'mappin', asset: 'assets/2cc11dd22ee33f01.png' },
        { localRef: 'emoji_plane', name: 'plane', asset: 'assets/2cc11dd22ee33f02.png' },
        { localRef: 'emoji_camera', name: 'camera', asset: 'assets/2cc11dd22ee33f03.png' },
        { localRef: 'emoji_live', name: 'live', asset: 'assets/2cc11dd22ee33f04.gif', animated: true },
      ],
      stickers: [
        { localRef: 'sticker_wave', name: 'safe travels', description: 'Wave-off travel sticker', tags: '✈️', asset: 'assets/2cc11dd22ee33f05.png', formatType: 1 },
      ],
      automod: [
        {
          localRef: 'am_scam_links', name: 'Block scam & phishing links', eventType: 1, triggerType: 1,
          triggerMetadata: { keywordFilter: ['free*nitro', 'discordgift*'], allowList: [] },
          actions: [{ type: 1, customMessage: 'Blocked: suspected scam link.' }, { type: 2, alertChannelRef: 'chan_safety' }],
          enabled: true, exemptRoleRefs: ['role_creator', 'role_mod'],
        },
        {
          localRef: 'am_spam', name: 'Spam content filter', eventType: 1, triggerType: 3, triggerMetadata: {},
          actions: [{ type: 1, customMessage: 'Please slow down — that looked like spam.' }],
          enabled: true, exemptRoleRefs: ['role_creator', 'role_mod'],
        },
      ],
      bots: [
        {
          localRef: 'bot_streamcord', sourceId: '375805687529209857', name: 'Streamcord', vendorGuess: 'Streamcord', inviteUrl: 'https://streamcord.io/twitch/',
          reconfigureNotes: ['connect the Twitch channel', 'post go-live alerts in #stream-announcements', 'ping the Live Ping role'],
          configTraces: [{ kind: 'webhook', where: "webhook in #stream-announcements", ref: 'chan_stream_announcements', detail: 'go-live alerts' }],
        },
      ],
      content: [
        {
          channelRef: 'chan_rules', hasInteractiveComponents: false,
          messages: [{
            authorName: 'Wander', authorIsBot: false, pinned: true,
            content: 'Welcome to **Wander**. A few ground rules to keep this a good place.',
            embeds: [{
              title: 'Wander Rules', color: 0x0ea5e9, description: 'Be kind, be safe, respect privacy.',
              footerText: 'Wander | IRL Travel',
              fields: [
                { name: '1. Be respectful', value: 'No harassment, hate, or witch-hunting.', inline: false },
                { name: '2. No doxxing', value: 'Never share anyone’s live location, including the streamer’s.', inline: false },
                { name: '3. Meetup safety', value: 'Public places, tell a friend, read #safety first.', inline: false },
                { name: '4. No advertising', value: 'No unsolicited links, DMs, or self-promo.', inline: false },
              ],
            }],
          }],
        },
        {
          channelRef: 'chan_welcome', hasInteractiveComponents: false,
          messages: [{
            authorName: 'Wander', authorIsBot: false, pinned: true, content: 'Welcome aboard, traveler.',
            embeds: [{
              title: 'Welcome to Wander 🌍', color: 0x0ea5e9,
              description: 'Pick your region in #role-select, then say hi in #general. Catch us live in #stream-announcements.',
              fields: [
                { name: 'Start here', value: 'Read #rules → pick a region in #role-select.', inline: true },
                { name: 'Never miss live', value: 'Grab the Live Ping role.', inline: true },
              ],
            }],
          }],
        },
        {
          channelRef: 'chan_role_select', hasInteractiveComponents: true,
          messages: [{
            authorName: 'Carl-bot', authorIsBot: true, pinned: true,
            content: 'Pick your region and pings below.',
            embeds: [{ title: 'Self-Assign Roles', color: 0x0ea5e9, description: 'Use the menu to set your region, buttons for pings.' }],
            componentSummary: ['select: Region (NA / EU / APAC)', 'button: 🔴 Live Ping', 'button: 🌟 Supporter info'],
          }],
        },
      ],
      brandTokens: [
        { kind: 'name', value: 'Wander', occurrences: 8, sources: ['server name', 'role: Wander', '#rules embed', '#welcome embed'] },
        { kind: 'color', value: '#0ea5e9', occurrences: 7, sources: ['role: Wander', 'role: Supporter', '#rules embed', '#welcome embed'] },
      ],
    }),
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 3. CASINO SPONSOR PACK — affiliate / sponsor-driven
//    7 categories · 20 channels · 11 roles
//    Focus: #sponsor-offers, #referral-codes, #payout-proof, partner roles, compliance/#rules emphasis.
// ════════════════════════════════════════════════════════════════════════════════════════════════
function casinoSponsorPack(): StarterPack {
  return {
    key: 'sponsor',
    title: 'Casino Sponsor Pack',
    pitch:
      'An affiliate-first server built around sponsor offers: a curated offers board, referral-code vault, verified payout-proof forum, partner/affiliate roles, and a heavy compliance layer. Monetize from day one, safely.',
    niche: 'Affiliate / sponsor-driven casino',
    snapshot: Snapshot.parse({
      capturedAt: '2026-06-23T12:00:00.000Z',
      source: {
        guildId: '000000000000000300',
        name: 'Highroll Partners | Sponsors',
        ownerNote: 'Starter template — affiliate/sponsor casino hub with payout proof + compliance emphasis.',
      },
      guild: {
        name: 'Highroll Partners | Sponsors',
        verificationLevel: 3,
        defaultMessageNotifications: 1,
        explicitContentFilter: 2,
        afkChannelRef: 'chan_afk',
        afkTimeout: 900,
        systemChannelRef: 'chan_welcome',
        systemChannelFlags: 4,
        rulesChannelRef: 'chan_rules',
        publicUpdatesChannelRef: 'chan_announcements',
        preferredLocale: 'en-US',
        premiumTier: 0,
        assets: { icon: 'assets/300ee11ff2aa33bb.png' },
        welcomeScreen: {
          enabled: true,
          description: 'Welcome to Highroll Partners — read the compliance rules, then grab the best offers.',
          welcomeChannels: [
            { channelRef: 'chan_rules', description: 'Compliance & rules (required)', emojiUnicode: '⚖️' },
            { channelRef: 'chan_sponsor_offers', description: 'Current sponsor offers', emojiRef: 'emoji_deal' },
            { channelRef: 'chan_referral_codes', description: 'Referral / promo codes', emojiUnicode: '🎟️' },
            { channelRef: 'chan_payout_proof', description: 'Verified payout proof', emojiRef: 'emoji_cash' },
          ],
        },
      },
      roles: [
        { localRef: 'role_everyone', sourceId: '000000000000000300', name: '@everyone', isEveryone: true, colors: { primary: 0 }, position: 0, permissions: '104324673' },
        { localRef: 'role_owner', name: 'Owner', colors: { primary: 0x047857 }, hoist: true, position: 10, permissions: '1099511627775', mentionable: false },
        { localRef: 'role_admin', name: 'Admin', colors: { primary: 0x10b981 }, hoist: true, position: 9, permissions: '8', mentionable: true },
        { localRef: 'role_compliance', name: 'Compliance', colors: { primary: 0xdc2626 }, hoist: true, position: 8, permissions: '1290157103', mentionable: true },
        { localRef: 'role_mod', name: 'Moderator', colors: { primary: 0x65a30d }, hoist: true, position: 7, permissions: '1290157103', mentionable: true },
        { localRef: 'role_sponsor', name: 'Sponsor 💼', colors: { primary: 0xca8a04, secondary: 0x047857 }, hoist: true, position: 6, permissions: '0', mentionable: true, unicodeEmoji: '💼' },
        { localRef: 'role_partner', name: 'Verified Partner', colors: { primary: 0x047857 }, hoist: true, position: 5, permissions: '0', mentionable: true },
        { localRef: 'role_affiliate', name: 'Affiliate', colors: { primary: 0x22c55e }, hoist: true, position: 4, permissions: '0', mentionable: true },
        { localRef: 'role_verified', name: 'Verified Payout', colors: { primary: 0x16a34a }, hoist: false, position: 3, permissions: '0', mentionable: false },
        { localRef: 'role_member', name: 'Member', colors: { primary: 0 }, hoist: false, position: 2, permissions: '0', mentionable: false },
        { localRef: 'role_offer_ping', name: 'Offer Ping', colors: { primary: 0xf59e0b }, hoist: false, position: 1, permissions: '0', mentionable: true },
      ],
      categories: [
        { localRef: 'cat_welcome', name: 'WELCOME', position: 0 },
        {
          localRef: 'cat_compliance',
          name: 'COMPLIANCE',
          position: 1,
          overwrites: [{ targetType: 'role', targetRef: 'role_everyone', allow: '1024', deny: '2048' }],
        },
        { localRef: 'cat_offers', name: 'OFFERS', position: 2 },
        { localRef: 'cat_proof', name: 'PROOF', position: 3 },
        { localRef: 'cat_community', name: 'COMMUNITY', position: 4 },
        {
          localRef: 'cat_partners',
          name: 'PARTNERS',
          position: 5,
          overwrites: [
            { targetType: 'role', targetRef: 'role_everyone', allow: '0', deny: '1024' },
            { targetType: 'role', targetRef: 'role_partner', allow: '1024', deny: '0' },
            { targetType: 'role', targetRef: 'role_affiliate', allow: '1024', deny: '0' },
            { targetType: 'role', targetRef: 'role_sponsor', allow: '1024', deny: '0' },
          ],
        },
        { localRef: 'cat_voice', name: 'VOICE', position: 6 },
      ],
      channels: [
        // WELCOME
        { localRef: 'chan_welcome', kind: 'text', name: 'welcome', categoryRef: 'cat_welcome', position: 0, topic: 'New here? Read #rules then check #sponsor-offers.', copyPolicy: 'system_content', copyContent: true, overwrites: [{ targetType: 'role', targetRef: 'role_everyone', allow: '1024', deny: '2048' }] },
        { localRef: 'chan_announcements', kind: 'announcement', name: 'announcements', categoryRef: 'cat_welcome', position: 1, topic: 'Official announcements & new sponsor partnerships.', copyPolicy: 'system_content', copyContent: true, overwrites: [{ targetType: 'role', targetRef: 'role_everyone', allow: '0', deny: '2048' }, { targetType: 'role', targetRef: 'role_admin', allow: '2048', deny: '0' }] },
        { localRef: 'chan_role_select', kind: 'text', name: 'role-select', categoryRef: 'cat_welcome', position: 2, topic: 'Pick ping roles. Affiliate verification in #verification.', copyPolicy: 'system_content', copyContent: true, overwrites: [{ targetType: 'role', targetRef: 'role_everyone', allow: '1024', deny: '2048' }] },
        // COMPLIANCE
        { localRef: 'chan_rules', kind: 'text', name: 'rules', categoryRef: 'cat_compliance', position: 0, topic: 'Rules + compliance. 18+ only. Affiliate disclosure required. Read fully.', copyPolicy: 'system_content', copyContent: true, overwrites: [{ targetType: 'role', targetRef: 'role_everyone', allow: '1024', deny: '2048' }] },
        { localRef: 'chan_responsible_gambling', kind: 'text', name: 'responsible-gambling', categoryRef: 'cat_compliance', position: 1, topic: 'Help, limits & resources. Gamble responsibly.', copyPolicy: 'system_content', copyContent: true, overwrites: [{ targetType: 'role', targetRef: 'role_everyone', allow: '1024', deny: '2048' }] },
        { localRef: 'chan_disclosures', kind: 'text', name: 'disclosures', categoryRef: 'cat_compliance', position: 2, topic: 'Affiliate / sponsorship disclosures (required reading).', copyPolicy: 'system_content', copyContent: true, overwrites: [{ targetType: 'role', targetRef: 'role_everyone', allow: '1024', deny: '2048' }] },
        // OFFERS
        { localRef: 'chan_sponsor_offers', kind: 'text', name: 'sponsor-offers', categoryRef: 'cat_offers', position: 0, topic: 'Curated current sponsor offers. Staff-posted only.', copyPolicy: 'system_content', copyContent: true, overwrites: [{ targetType: 'role', targetRef: 'role_everyone', allow: '0', deny: '2048' }, { targetType: 'role', targetRef: 'role_admin', allow: '2048', deny: '0' }] },
        { localRef: 'chan_referral_codes', kind: 'text', name: 'referral-codes', categoryRef: 'cat_offers', position: 1, topic: 'Active referral / promo codes. Verified partners may post.', copyPolicy: 'system_content', copyContent: true, overwrites: [{ targetType: 'role', targetRef: 'role_everyone', allow: '0', deny: '2048' }, { targetType: 'role', targetRef: 'role_partner', allow: '2048', deny: '0' }, { targetType: 'role', targetRef: 'role_mod', allow: '2048', deny: '0' }] },
        { localRef: 'chan_offer_discussion', kind: 'text', name: 'offer-discussion', categoryRef: 'cat_offers', position: 2, topic: 'Discuss the offers. No posting your own links here.', rateLimitPerUser: 5, copyPolicy: 'member_chat' },
        // PROOF
        {
          localRef: 'chan_payout_proof', kind: 'forum', name: 'payout-proof', categoryRef: 'cat_proof', position: 0,
          topic: 'Post verified payout proof. Screenshots required. Mods verify.',
          rateLimitPerUser: 0, defaultForumLayout: 1, defaultSortOrder: 0, defaultAutoArchiveDuration: 4320, defaultThreadRateLimitPerUser: 10,
          defaultReaction: { emojiRef: 'emoji_cash' }, copyPolicy: 'member_chat',
          forumTags: [
            { localRef: 'tag_pending', name: 'Pending Review', moderated: true, emojiUnicode: '⏳' },
            { localRef: 'tag_verified', name: 'Verified', moderated: true, emojiRef: 'emoji_check' },
            { localRef: 'tag_big', name: 'Big Payout', moderated: false, emojiRef: 'emoji_cash' },
          ],
        },
        { localRef: 'chan_verification', kind: 'text', name: 'verification', categoryRef: 'cat_proof', position: 1, topic: 'Apply to become a Verified Partner / Affiliate.', copyPolicy: 'member_chat', overwrites: [{ targetType: 'role', targetRef: 'role_everyone', allow: '1024', deny: '0' }, { targetType: 'role', targetRef: 'role_compliance', allow: '8192', deny: '0' }] },
        // COMMUNITY
        { localRef: 'chan_general', kind: 'text', name: 'general', categoryRef: 'cat_community', position: 0, topic: 'General chat. Keep it friendly & compliant.', rateLimitPerUser: 3, copyPolicy: 'member_chat' },
        { localRef: 'chan_wins', kind: 'text', name: 'wins', categoryRef: 'cat_community', position: 1, topic: 'Share your wins (proof goes in #payout-proof).', copyPolicy: 'member_chat' },
        { localRef: 'chan_support', kind: 'text', name: 'support', categoryRef: 'cat_community', position: 2, topic: 'Questions about offers or the server.', copyPolicy: 'member_chat' },
        { localRef: 'chan_mod_log', kind: 'text', name: 'mod-log', categoryRef: 'cat_community', position: 3, topic: 'AutoMod alerts & moderation log.', copyPolicy: 'member_chat', overwrites: [{ targetType: 'role', targetRef: 'role_everyone', allow: '0', deny: '1024' }, { targetType: 'role', targetRef: 'role_mod', allow: '1024', deny: '0' }, { targetType: 'role', targetRef: 'role_compliance', allow: '1024', deny: '0' }] },
        // PARTNERS
        { localRef: 'chan_partner_lounge', kind: 'text', name: 'partner-lounge', categoryRef: 'cat_partners', position: 0, topic: 'Verified partners, affiliates & sponsors only.', copyPolicy: 'member_chat', overwrites: [{ targetType: 'role', targetRef: 'role_everyone', allow: '0', deny: '1024' }, { targetType: 'role', targetRef: 'role_partner', allow: '1024', deny: '0' }, { targetType: 'role', targetRef: 'role_affiliate', allow: '1024', deny: '0' }] },
        { localRef: 'chan_deal_desk', kind: 'text', name: 'deal-desk', categoryRef: 'cat_partners', position: 1, topic: 'Negotiate deals with sponsors. Sponsors + partners only.', copyPolicy: 'member_chat', overwrites: [{ targetType: 'role', targetRef: 'role_everyone', allow: '0', deny: '1024' }, { targetType: 'role', targetRef: 'role_sponsor', allow: '1024', deny: '0' }, { targetType: 'role', targetRef: 'role_partner', allow: '1024', deny: '0' }] },
        // VOICE
        { localRef: 'chan_voice_lounge', kind: 'voice', name: 'Lounge', categoryRef: 'cat_voice', position: 0, bitrate: 96000, userLimit: 20, rtcRegion: null, videoQualityMode: 1, copyPolicy: 'member_chat' },
        { localRef: 'chan_afk', kind: 'voice', name: 'AFK', categoryRef: 'cat_voice', position: 1, bitrate: 64000, userLimit: 0, copyPolicy: 'member_chat' },
      ],
      emojis: [
        { localRef: 'emoji_deal', name: 'deal', asset: 'assets/3ee11ff22aa33b01.png' },
        { localRef: 'emoji_cash', name: 'cash', asset: 'assets/3ee11ff22aa33b02.png' },
        { localRef: 'emoji_check', name: 'verified', asset: 'assets/3ee11ff22aa33b03.png' },
        { localRef: 'emoji_handshake', name: 'partner', asset: 'assets/3ee11ff22aa33b04.png' },
      ],
      stickers: [
        { localRef: 'sticker_paid', name: 'PAID OUT', description: 'Verified payout celebration sticker', tags: '💰', asset: 'assets/3ee11ff22aa33b05.png', formatType: 1 },
      ],
      automod: [
        {
          localRef: 'am_unverified_links', name: 'Block unapproved affiliate links', eventType: 1, triggerType: 1,
          triggerMetadata: { keywordFilter: ['free*nitro', 'discordgift*'], regexPatterns: ['(?i)bit\\.ly/\\S+'], allowList: [] },
          actions: [{ type: 1, customMessage: 'Only verified partners may post links, and only in #referral-codes.' }, { type: 2, alertChannelRef: 'chan_mod_log' }],
          enabled: true, exemptRoleRefs: ['role_admin', 'role_mod', 'role_partner'], exemptChannelRefs: ['chan_referral_codes', 'chan_sponsor_offers'],
        },
        {
          localRef: 'am_spam', name: 'Spam content filter', eventType: 1, triggerType: 3, triggerMetadata: {},
          actions: [{ type: 1, customMessage: 'Please slow down — that looked like spam.' }],
          enabled: true, exemptRoleRefs: ['role_admin', 'role_mod'],
        },
        {
          localRef: 'am_mention_spam', name: 'Mention raid protection', eventType: 1, triggerType: 5,
          triggerMetadata: { mentionTotalLimit: 6, mentionRaidProtectionEnabled: true },
          actions: [{ type: 1 }, { type: 3, durationSeconds: 600 }, { type: 2, alertChannelRef: 'chan_mod_log' }],
          enabled: true, exemptRoleRefs: ['role_admin', 'role_mod'],
        },
      ],
      bots: [
        {
          localRef: 'bot_carl', sourceId: '235148962103951360', name: 'Carl-bot', vendorGuess: 'Carl-bot', inviteUrl: 'https://carl.gg/',
          reconfigureNotes: ['reaction roles in #role-select', 'logging to #mod-log', 'automod assist'],
          configTraces: [{ kind: 'permission_overwrite', where: '#role-select overwrite', ref: 'chan_role_select', detail: 'reaction-role message' }],
        },
        {
          localRef: 'bot_tickets', sourceId: '557628352828014614', name: 'Ticket Tool', vendorGuess: 'Ticket Tool', inviteUrl: 'https://tickettool.xyz/',
          reconfigureNotes: ['recreate partner-application panel in #verification', 're-add Compliance role permissions', 'restore transcript channel'],
          configTraces: [{ kind: 'permission_overwrite', where: '#verification overwrite', ref: 'chan_verification', detail: 'application tickets' }],
        },
      ],
      content: [
        {
          channelRef: 'chan_rules', hasInteractiveComponents: false,
          messages: [{
            authorName: 'Highroll Partners', authorIsBot: false, pinned: true,
            content: 'Welcome to **Highroll Partners**. This is a sponsor & affiliate hub — compliance is mandatory. 18+ only.',
            embeds: [{
              title: 'Rules & Compliance', color: 0x047857,
              description: 'Read fully. Posting unapproved links or hiding affiliate relationships is an instant ban.',
              footerText: 'Highroll Partners | Sponsors',
              fields: [
                { name: '1. 18+ only', value: 'This is a gambling-adjacent community. Legal age required.', inline: false },
                { name: '2. Disclose affiliations', value: 'All affiliate / sponsored content must be disclosed. See #disclosures.', inline: false },
                { name: '3. Approved links only', value: 'Only verified partners may post links, only in #referral-codes.', inline: false },
                { name: '4. Gamble responsibly', value: 'See #responsible-gambling for help & limits.', inline: false },
              ],
            }],
          }],
        },
        {
          channelRef: 'chan_sponsor_offers', hasInteractiveComponents: false,
          messages: [{
            authorName: 'Highroll Partners', authorIsBot: false, pinned: true,
            content: 'Current vetted sponsor offers. We only list partners we trust — always read the T&Cs.',
            embeds: [{
              title: 'Featured Offers', color: 0x047857,
              description: 'Offers rotate weekly. Grab the **Offer Ping** role in #role-select to be notified.',
              fields: [
                { name: 'How to claim', value: 'Use the code in #referral-codes at signup.', inline: true },
                { name: 'Proof', value: 'Post payouts in #payout-proof to earn Verified Payout.', inline: true },
              ],
            }],
          }],
        },
        {
          channelRef: 'chan_welcome', hasInteractiveComponents: false,
          messages: [{
            authorName: 'Highroll Partners', authorIsBot: false, pinned: true, content: 'Welcome to the partners hub.',
            embeds: [{
              title: 'Welcome to Highroll Partners 💼', color: 0x047857,
              description: 'Read #rules and #disclosures first, then browse #sponsor-offers. Apply to partner in #verification.',
              fields: [
                { name: 'Start here', value: 'Read #rules → #disclosures.', inline: true },
                { name: 'Get verified', value: 'Apply in #verification.', inline: true },
              ],
            }],
          }],
        },
        {
          channelRef: 'chan_role_select', hasInteractiveComponents: true,
          messages: [{
            authorName: 'Carl-bot', authorIsBot: true, pinned: true,
            content: 'Pick your ping roles below.',
            embeds: [{ title: 'Self-Assign Roles', color: 0x047857, description: 'Click a button to toggle a role.' }],
            componentSummary: ['button: 🔔 Offer Ping', 'button: 💼 Apply as Partner', 'select: Preferred sportsbook / casino'],
          }],
        },
      ],
      brandTokens: [
        { kind: 'name', value: 'Highroll Partners', occurrences: 9, sources: ['server name', 'role: Sponsor', '#rules embed', '#welcome embed', '#sponsor-offers embed'] },
        { kind: 'color', value: '#047857', occurrences: 8, sources: ['role: Owner', 'role: Verified Partner', 'category: PARTNERS', '#rules embed', '#welcome embed'] },
      ],
    }),
  };
}
