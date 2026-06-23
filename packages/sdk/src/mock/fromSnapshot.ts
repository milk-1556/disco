import type { RawEmbed, RawMessage, RawOverwrite } from '@disco/core';
import type { Snapshot } from '@disco/schema';
import { MockGuild } from './mockGuild.js';

const TYPE_OF_KIND: Record<string, number> = { text: 0, voice: 2, category: 4, announcement: 5, stage: 13, forum: 15, media: 16 };

/**
 * Materialize a Snapshot into an in-memory source MockGuild (assigning fake snowflake ids), so the
 * capture engine can read it back. Used by the integration test to prove capture → rebrand →
 * rebuild → report against a known structure without any live Discord guild.
 */
export function mockGuildFromSnapshot(snap: Snapshot): MockGuild {
  const guildId = snap.source.guildId;
  const mg = new MockGuild(guildId, snap.guild.name);
  let seq = 5000;
  const id = () => String(800000000000000000n + BigInt(seq++));

  const roleId = new Map<string, string>();
  const chanId = new Map<string, string>();
  const emojiId = new Map<string, string>();

  // Guild settings + assets
  const assetUrl = (key?: string) => (key ? `mock://asset/${key}` : null);
  Object.assign(mg.guild, {
    verificationLevel: snap.guild.verificationLevel,
    defaultMessageNotifications: snap.guild.defaultMessageNotifications,
    explicitContentFilter: snap.guild.explicitContentFilter,
    afkTimeout: snap.guild.afkTimeout,
    systemChannelFlags: snap.guild.systemChannelFlags,
    preferredLocale: snap.guild.preferredLocale,
    premiumTier: snap.guild.premiumTier,
    iconUrl: assetUrl(snap.guild.assets.icon),
    bannerUrl: assetUrl(snap.guild.assets.banner),
    splashUrl: assetUrl(snap.guild.assets.splash),
    discoverySplashUrl: assetUrl(snap.guild.assets.discoverySplash),
  });

  // Roles
  mg.roles.clear();
  for (const r of snap.roles) {
    const rid = r.isEveryone ? guildId : id();
    roleId.set(r.localRef, rid);
    mg.roles.set(rid, {
      id: rid,
      name: r.name,
      colors: r.colors,
      hoist: r.hoist,
      position: r.position,
      permissions: r.permissions,
      managed: r.managed,
      mentionable: r.mentionable,
      ...(r.tags ? { tags: r.tags } : {}),
      ...(r.unicodeEmoji ? { unicodeEmoji: r.unicodeEmoji } : {}),
    });
  }

  // Emojis & stickers
  for (const e of snap.emojis) {
    const eid = id();
    emojiId.set(e.localRef, eid);
    mg.emojis.set(eid, { id: eid, name: e.name, animated: e.animated, managed: e.managed, roleIds: e.roleRefs.map((r) => roleId.get(r)!).filter(Boolean), imageUrl: `mock://asset/${e.asset}` });
  }
  for (const s of snap.stickers) {
    const sid = id();
    mg.stickers.set(sid, { id: sid, name: s.name, description: s.description, tags: s.tags, formatType: s.formatType, imageUrl: `mock://asset/${s.asset}` });
  }

  const mapOverwrites = (ows: Snapshot['channels'][number]['overwrites']): RawOverwrite[] =>
    ows.map((o) => ({
      id: o.targetType === 'role' ? roleId.get(o.targetRef) ?? o.targetRef : o.targetRef.replace(/^member_/, ''),
      type: o.targetType === 'member' ? 1 : 0,
      allow: o.allow,
      deny: o.deny,
    }));

  // Categories first
  for (const c of snap.categories) {
    const cid = id();
    chanId.set(c.localRef, cid);
    mg.channels.set(cid, { id: cid, type: 4, name: c.name, parentId: null, position: c.position, permissionOverwrites: mapOverwrites(c.overwrites) });
  }
  // Channels
  for (const c of snap.channels) {
    const cid = id();
    chanId.set(c.localRef, cid);
    mg.channels.set(cid, {
      id: cid,
      type: TYPE_OF_KIND[c.kind] ?? 0,
      name: c.name,
      parentId: c.categoryRef ? chanId.get(c.categoryRef) ?? null : null,
      position: c.position,
      topic: c.topic,
      nsfw: c.nsfw,
      rateLimitPerUser: c.rateLimitPerUser,
      bitrate: c.bitrate,
      userLimit: c.userLimit,
      rtcRegion: c.rtcRegion,
      videoQualityMode: c.videoQualityMode,
      defaultForumLayout: c.defaultForumLayout,
      defaultSortOrder: c.defaultSortOrder,
      defaultThreadRateLimitPerUser: c.defaultThreadRateLimitPerUser,
      defaultAutoArchiveDuration: c.defaultAutoArchiveDuration,
      permissionOverwrites: mapOverwrites(c.overwrites),
    });
  }

  // AutoMod
  for (const a of snap.automod) {
    const aid = id();
    mg.automod.set(aid, {
      id: aid,
      name: a.name,
      eventType: a.eventType,
      triggerType: a.triggerType,
      triggerMetadata: a.triggerMetadata as Record<string, unknown>,
      actions: a.actions.map((ac) => ({
        type: ac.type,
        metadata: {
          ...(ac.customMessage ? { customMessage: ac.customMessage } : {}),
          ...(ac.alertChannelRef && chanId.get(ac.alertChannelRef) ? { channelId: chanId.get(ac.alertChannelRef)! } : {}),
          ...(ac.durationSeconds != null ? { durationSeconds: ac.durationSeconds } : {}),
        },
      })),
      enabled: a.enabled,
      exemptRoles: a.exemptRoleRefs.map((r) => roleId.get(r)!).filter(Boolean),
      exemptChannels: a.exemptChannelRefs.map((r) => chanId.get(r)!).filter(Boolean),
    });
  }

  // Bots
  for (const b of snap.bots) {
    mg.bots.set(b.sourceId, { id: b.sourceId, username: b.name, applicationId: b.sourceId });
  }

  // Content → messages keyed by channel id
  const toRawEmbed = (e: Snapshot['content'][number]['messages'][number]['embeds'][number]): RawEmbed => ({
    title: e.title,
    description: e.description,
    url: e.url,
    color: e.color,
    author: e.authorName ? { name: e.authorName, url: e.authorUrl ?? undefined, iconUrl: e.authorIconUrl ?? undefined } : null,
    footer: e.footerText ? { text: e.footerText, iconUrl: e.footerIconUrl ?? undefined } : null,
    image: e.imageUrl ? { url: e.imageUrl } : null,
    thumbnail: e.thumbnailUrl ? { url: e.thumbnailUrl } : null,
    timestamp: e.timestamp,
    fields: e.fields.map((f) => ({ name: f.name, value: f.value, inline: f.inline })),
  });
  for (const cc of snap.content) {
    const cid = chanId.get(cc.channelRef);
    if (!cid) continue;
    const msgs: RawMessage[] = cc.messages.map((m) => ({
      id: id(),
      author: { username: m.authorName, avatarUrl: m.authorAvatarUrl, bot: m.authorIsBot },
      content: m.content,
      embeds: m.embeds.map(toRawEmbed),
      pinned: m.pinned,
      componentSummary: m.componentSummary,
      createdAt: m.createdAt,
    }));
    mg.messages.set(cid, msgs);
  }

  // Welcome screen + pointers
  if (snap.guild.welcomeScreen) {
    mg.welcomeScreen = {
      enabled: snap.guild.welcomeScreen.enabled,
      description: snap.guild.welcomeScreen.description,
      welcomeChannels: snap.guild.welcomeScreen.welcomeChannels
        .map((wc) => {
          const c = chanId.get(wc.channelRef);
          return c ? { channelId: c, description: wc.description, emojiId: null, emojiName: wc.emojiUnicode } : null;
        })
        .filter((x): x is NonNullable<typeof x> => !!x),
    };
  }
  mg.guild.systemChannelId = snap.guild.systemChannelRef ? chanId.get(snap.guild.systemChannelRef) ?? null : null;
  mg.guild.rulesChannelId = snap.guild.rulesChannelRef ? chanId.get(snap.guild.rulesChannelRef) ?? null : null;
  mg.guild.publicUpdatesChannelId = snap.guild.publicUpdatesChannelRef ? chanId.get(snap.guild.publicUpdatesChannelRef) ?? null : null;
  mg.guild.afkChannelId = snap.guild.afkChannelRef ? chanId.get(snap.guild.afkChannelRef) ?? null : null;

  return mg;
}
