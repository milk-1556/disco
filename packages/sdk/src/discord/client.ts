import type {
  ApplyPort,
  CapturePort,
  CreateChannelInput,
  RawAutoModRule,
  RawBot,
  RawChannel,
  RawEmoji,
  RawGuildSettings,
  RawMessage,
  RawOverwrite,
  RawRole,
  RawRoleColors,
  RawSticker,
  RawWelcomeScreen,
} from '@disco/core';
import { REST, Routes } from 'discord.js';
import type { AssetStore } from '../storage.js';
import { extFromUrl } from '../storage.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

export interface DiscordGuildClientOptions {
  token: string;
  guildId: string;
  store: AssetStore;
  /** discord.js REST instance (so api/worker can share one); created if omitted. */
  rest?: REST;
}

const CDN = 'https://cdn.discordapp.com';

/**
 * The live discord.js v14 implementation of both ports, talking to the official Discord REST API via
 * discord.js's REST client — which provides the global + per-route rate-limit queue and adaptive 429
 * backoff required by §6. Requires a bot token with Administrator and the privileged intents listed
 * in the README. LIVE-GATED: only run against a real guild the operator knowingly targets.
 */
export class DiscordGuildClient implements CapturePort, ApplyPort {
  private rest: REST;
  private guildId: string;
  private store: AssetStore;

  constructor(opts: DiscordGuildClientOptions) {
    this.guildId = opts.guildId;
    this.store = opts.store;
    this.rest = opts.rest ?? new REST({ version: '10' }).setToken(opts.token);
  }

  // ───────────────────────────── helpers ─────────────────────────────
  private async dataUri(key: string): Promise<string> {
    const bytes = await this.store.get(key);
    const ext = key.split('.').pop() ?? 'png';
    const mime = ext === 'gif' ? 'image/gif' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
    return `data:${mime};base64,${bytes.toString('base64')}`;
  }

  // ───────────────────────────── CapturePort ─────────────────────────────
  async getGuild(): Promise<RawGuildSettings> {
    const g = (await this.rest.get(Routes.guild(this.guildId))) as Json;
    const asset = (hash: string | null, path: string, anim = false) =>
      hash ? `${CDN}/${path}/${hash}.${anim && hash.startsWith('a_') ? 'gif' : 'png'}` : null;
    return {
      id: g.id,
      name: g.name,
      verificationLevel: g.verification_level ?? 0,
      defaultMessageNotifications: g.default_message_notifications ?? 0,
      explicitContentFilter: g.explicit_content_filter ?? 0,
      afkChannelId: g.afk_channel_id ?? null,
      afkTimeout: g.afk_timeout ?? 300,
      systemChannelId: g.system_channel_id ?? null,
      systemChannelFlags: g.system_channel_flags ?? 0,
      rulesChannelId: g.rules_channel_id ?? null,
      publicUpdatesChannelId: g.public_updates_channel_id ?? null,
      preferredLocale: g.preferred_locale ?? 'en-US',
      premiumTier: g.premium_tier ?? 0,
      iconUrl: asset(g.icon, `icons/${g.id}`, true),
      bannerUrl: asset(g.banner, `banners/${g.id}`, true),
      splashUrl: asset(g.splash, `splashes/${g.id}`),
      discoverySplashUrl: asset(g.discovery_splash, `discovery-splashes/${g.id}`),
    };
  }

  async getWelcomeScreen(): Promise<RawWelcomeScreen | null> {
    try {
      const w = (await this.rest.get(Routes.guildWelcomeScreen(this.guildId))) as Json;
      return {
        enabled: true,
        description: w.description ?? null,
        welcomeChannels: (w.welcome_channels ?? []).map((c: Json) => ({
          channelId: c.channel_id,
          description: c.description,
          emojiId: c.emoji_id ?? null,
          emojiName: c.emoji_name ?? null,
        })),
      };
    } catch {
      return null; // community features off → no welcome screen
    }
  }

  async listRoles(): Promise<RawRole[]> {
    const roles = (await this.rest.get(Routes.guildRoles(this.guildId))) as Json[];
    return roles.map((r): RawRole => {
      const colors: RawRoleColors = {
        primary: r.colors?.primary_color ?? r.color ?? 0,
        secondary: r.colors?.secondary_color ?? null,
        tertiary: r.colors?.tertiary_color ?? null,
      };
      return {
        id: r.id,
        name: r.name,
        colors,
        hoist: !!r.hoist,
        position: r.position ?? 0,
        permissions: String(r.permissions ?? '0'),
        managed: !!r.managed,
        mentionable: !!r.mentionable,
        iconUrl: r.icon ? `${CDN}/role-icons/${r.id}/${r.icon}.png` : null,
        unicodeEmoji: r.unicode_emoji ?? null,
        tags: r.tags
          ? {
              botId: r.tags.bot_id,
              integrationId: r.tags.integration_id,
              premiumSubscriber: 'premium_subscriber' in r.tags,
            }
          : undefined,
      };
    });
  }

  async listChannels(): Promise<RawChannel[]> {
    const chans = (await this.rest.get(Routes.guildChannels(this.guildId))) as Json[];
    return chans.map((c): RawChannel => ({
      id: c.id,
      type: c.type,
      name: c.name,
      parentId: c.parent_id ?? null,
      position: c.position ?? 0,
      topic: c.topic ?? null,
      nsfw: !!c.nsfw,
      rateLimitPerUser: c.rate_limit_per_user ?? 0,
      bitrate: c.bitrate ?? null,
      userLimit: c.user_limit ?? null,
      rtcRegion: c.rtc_region ?? null,
      videoQualityMode: c.video_quality_mode ?? null,
      availableTags: (c.available_tags ?? []).map((t: Json) => ({
        id: t.id,
        name: t.name,
        moderated: !!t.moderated,
        emojiId: t.emoji_id ?? null,
        emojiName: t.emoji_name ?? null,
      })),
      defaultReactionEmoji: c.default_reaction_emoji
        ? { emojiId: c.default_reaction_emoji.emoji_id ?? null, emojiName: c.default_reaction_emoji.emoji_name ?? null }
        : null,
      defaultForumLayout: c.default_forum_layout ?? null,
      defaultSortOrder: c.default_sort_order ?? null,
      defaultThreadRateLimitPerUser: c.default_thread_rate_limit_per_user ?? null,
      defaultAutoArchiveDuration: c.default_auto_archive_duration ?? null,
      permissionOverwrites: (c.permission_overwrites ?? []).map((o: Json) => ({
        id: o.id,
        type: o.type,
        allow: String(o.allow),
        deny: String(o.deny),
      })),
    }));
  }

  async listEmojis(): Promise<RawEmoji[]> {
    const emojis = (await this.rest.get(Routes.guildEmojis(this.guildId))) as Json[];
    return emojis.map((e): RawEmoji => ({
      id: e.id,
      name: e.name,
      animated: !!e.animated,
      managed: !!e.managed,
      roleIds: e.roles ?? [],
      imageUrl: `${CDN}/emojis/${e.id}.${e.animated ? 'gif' : 'png'}`,
    }));
  }

  async listStickers(): Promise<RawSticker[]> {
    const stickers = (await this.rest.get(Routes.guildStickers(this.guildId))) as Json[];
    return stickers.map((s): RawSticker => ({
      id: s.id,
      name: s.name,
      description: s.description ?? null,
      tags: s.tags ?? '',
      formatType: s.format_type ?? 1,
      imageUrl: `https://media.discordapp.net/stickers/${s.id}.${s.format_type === 3 ? 'json' : 'png'}`,
    }));
  }

  async listAutoModRules(): Promise<RawAutoModRule[]> {
    const rules = (await this.rest.get(Routes.guildAutoModerationRules(this.guildId))) as Json[];
    return rules.map((r): RawAutoModRule => ({
      id: r.id,
      name: r.name,
      eventType: r.event_type,
      triggerType: r.trigger_type,
      triggerMetadata: {
        keywordFilter: r.trigger_metadata?.keyword_filter ?? [],
        regexPatterns: r.trigger_metadata?.regex_patterns ?? [],
        presets: r.trigger_metadata?.presets ?? [],
        allowList: r.trigger_metadata?.allow_list ?? [],
        mentionTotalLimit: r.trigger_metadata?.mention_total_limit ?? null,
        mentionRaidProtectionEnabled: !!r.trigger_metadata?.mention_raid_protection_enabled,
      },
      actions: (r.actions ?? []).map((a: Json) => ({
        type: a.type,
        metadata: {
          channelId: a.metadata?.channel_id,
          customMessage: a.metadata?.custom_message,
          durationSeconds: a.metadata?.duration_seconds,
        },
      })),
      enabled: !!r.enabled,
      exemptRoles: r.exempt_roles ?? [],
      exemptChannels: r.exempt_channels ?? [],
    }));
  }

  async listBots(): Promise<RawBot[]> {
    const members = (await this.rest.get(Routes.guildMembers(this.guildId), {
      query: new URLSearchParams({ limit: '1000' }),
    })) as Json[];
    return members
      .filter((m) => m.user?.bot)
      .map((m): RawBot => ({ id: m.user.id, username: m.user.username, applicationId: m.user.id }));
  }

  async fetchMessages(channelId: string): Promise<RawMessage[]> {
    const msgs = (await this.rest.get(Routes.channelMessages(channelId), {
      query: new URLSearchParams({ limit: '100' }),
    })) as Json[];
    // API returns newest→oldest; copy oldest→newest.
    return msgs.reverse().map((m): RawMessage => ({
      id: m.id,
      author: {
        username: m.author?.username ?? 'Unknown',
        avatarUrl: m.author?.avatar ? `${CDN}/avatars/${m.author.id}/${m.author.avatar}.png` : null,
        bot: !!m.author?.bot,
      },
      content: m.content ?? '',
      embeds: (m.embeds ?? []).map((e: Json) => ({
        title: e.title ?? null,
        description: e.description ?? null,
        url: e.url ?? null,
        color: e.color ?? null,
        author: e.author ? { name: e.author.name, url: e.author.url, iconUrl: e.author.icon_url } : null,
        footer: e.footer ? { text: e.footer.text, iconUrl: e.footer.icon_url } : null,
        image: e.image ? { url: e.image.url } : null,
        thumbnail: e.thumbnail ? { url: e.thumbnail.url } : null,
        timestamp: e.timestamp ?? null,
        fields: (e.fields ?? []).map((f: Json) => ({ name: f.name, value: f.value, inline: !!f.inline })),
      })),
      pinned: !!m.pinned,
      componentSummary: summarizeComponents(m.components ?? []),
      createdAt: m.timestamp ?? null,
    }));
  }

  async persistAsset(url: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`asset download failed (${res.status}): ${url}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    return this.store.put(bytes, extFromUrl(url));
  }

  // ───────────────────────────── ApplyPort ─────────────────────────────
  async modifyGuild(
    patch: Partial<RawGuildSettings> & { iconKey?: string; bannerKey?: string; splashKey?: string },
  ): Promise<void> {
    const body: Json = {};
    if (patch.name !== undefined) body.name = patch.name;
    if (patch.verificationLevel !== undefined) body.verification_level = patch.verificationLevel;
    if (patch.defaultMessageNotifications !== undefined) body.default_message_notifications = patch.defaultMessageNotifications;
    if (patch.explicitContentFilter !== undefined) body.explicit_content_filter = patch.explicitContentFilter;
    if (patch.afkTimeout !== undefined) body.afk_timeout = patch.afkTimeout;
    if (patch.systemChannelFlags !== undefined) body.system_channel_flags = patch.systemChannelFlags;
    if (patch.preferredLocale !== undefined) body.preferred_locale = patch.preferredLocale;
    if (patch.iconKey) body.icon = await this.dataUri(patch.iconKey);
    if (patch.bannerKey) body.banner = await this.dataUri(patch.bannerKey);
    if (patch.splashKey) body.splash = await this.dataUri(patch.splashKey);
    await this.rest.patch(Routes.guild(this.guildId), { body });
  }

  async getEveryoneRoleId(): Promise<string> {
    return this.guildId; // @everyone role id always equals the guild id
  }

  async editEveryone(permissions: string): Promise<void> {
    await this.rest.patch(Routes.guildRole(this.guildId, this.guildId), { body: { permissions } });
  }

  async createRole(input: {
    name: string;
    colors: RawRoleColors;
    hoist: boolean;
    mentionable: boolean;
    permissions: string;
    iconKey?: string | null;
    unicodeEmoji?: string | null;
  }): Promise<string> {
    const body: Json = {
      name: input.name,
      color: input.colors.primary,
      hoist: input.hoist,
      mentionable: input.mentionable,
      permissions: input.permissions,
    };
    if (input.colors.secondary !== null) {
      body.colors = { primary_color: input.colors.primary, secondary_color: input.colors.secondary, tertiary_color: input.colors.tertiary };
    }
    if (input.iconKey) body.icon = await this.dataUri(input.iconKey);
    if (input.unicodeEmoji) body.unicode_emoji = input.unicodeEmoji;
    const role = (await this.rest.post(Routes.guildRoles(this.guildId), { body })) as Json;
    return role.id;
  }

  async editRole(
    id: string,
    input: Partial<{ name: string; colors: RawRoleColors; hoist: boolean; mentionable: boolean; permissions: string }>,
  ): Promise<void> {
    const body: Json = {};
    if (input.name !== undefined) body.name = input.name;
    if (input.colors) body.color = input.colors.primary;
    if (input.hoist !== undefined) body.hoist = input.hoist;
    if (input.mentionable !== undefined) body.mentionable = input.mentionable;
    if (input.permissions !== undefined) body.permissions = input.permissions;
    await this.rest.patch(Routes.guildRole(this.guildId, id), { body });
  }

  async reorderRoles(orderedIds: string[]): Promise<void> {
    const body = orderedIds.map((id, i) => ({ id, position: i + 1 }));
    await this.rest.patch(Routes.guildRoles(this.guildId), { body });
  }

  async createEmoji(input: { name: string; imageKey: string; roleIds: string[] }): Promise<string> {
    const emoji = (await this.rest.post(Routes.guildEmojis(this.guildId), {
      body: { name: input.name, image: await this.dataUri(input.imageKey), roles: input.roleIds },
    })) as Json;
    return emoji.id;
  }

  async createSticker(input: { name: string; description: string | null; tags: string; imageKey: string }): Promise<string> {
    // Stickers use multipart/form-data with plain fields (no payload_json).
    const bytes = await this.store.get(input.imageKey);
    const form = new FormData();
    form.append('name', input.name);
    form.append('tags', input.tags);
    form.append('description', input.description ?? '');
    form.append('file', new Blob([bytes], { type: 'image/png' }), 'sticker.png');
    const sticker = (await this.rest.post(Routes.guildStickers(this.guildId), {
      body: form,
      passThroughBody: true,
    } as Json)) as Json;
    return sticker.id;
  }

  async createChannel(input: CreateChannelInput): Promise<string> {
    const body: Json = {
      name: input.name,
      type: input.type,
      parent_id: input.parentId,
      position: input.position,
    };
    if (input.topic != null) body.topic = input.topic;
    if (input.nsfw != null) body.nsfw = input.nsfw;
    if (input.rateLimitPerUser != null) body.rate_limit_per_user = input.rateLimitPerUser;
    if (input.bitrate != null) body.bitrate = input.bitrate;
    if (input.userLimit != null) body.user_limit = input.userLimit;
    if (input.rtcRegion != null) body.rtc_region = input.rtcRegion;
    if (input.videoQualityMode != null) body.video_quality_mode = input.videoQualityMode;
    if (input.availableTags?.length) {
      body.available_tags = input.availableTags.map((t) => ({ name: t.name, moderated: t.moderated, emoji_id: t.emojiId, emoji_name: t.emojiName }));
    }
    if (input.defaultReactionEmoji) body.default_reaction_emoji = { emoji_id: input.defaultReactionEmoji.emojiId, emoji_name: input.defaultReactionEmoji.emojiName };
    if (input.defaultForumLayout != null) body.default_forum_layout = input.defaultForumLayout;
    if (input.defaultSortOrder != null) body.default_sort_order = input.defaultSortOrder;
    if (input.defaultThreadRateLimitPerUser != null) body.default_thread_rate_limit_per_user = input.defaultThreadRateLimitPerUser;
    if (input.defaultAutoArchiveDuration != null) body.default_auto_archive_duration = input.defaultAutoArchiveDuration;
    const channel = (await this.rest.post(Routes.guildChannels(this.guildId), { body })) as Json;
    return channel.id;
  }

  async setChannelOverwrites(channelId: string, overwrites: RawOverwrite[]): Promise<void> {
    // No bulk endpoint — PUT each overwrite individually.
    for (const o of overwrites) {
      await this.rest.put(Routes.channelPermission(channelId, o.id), {
        body: { type: o.type, allow: o.allow, deny: o.deny },
      });
    }
  }

  async createAutoModRule(input: Omit<RawAutoModRule, 'id'>): Promise<string> {
    const body: Json = {
      name: input.name,
      event_type: input.eventType,
      trigger_type: input.triggerType,
      trigger_metadata: snakeTriggerMeta(input.triggerMetadata),
      actions: input.actions.map((a) => ({
        type: a.type,
        metadata: {
          ...(a.metadata?.channelId ? { channel_id: a.metadata.channelId } : {}),
          ...(a.metadata?.customMessage ? { custom_message: a.metadata.customMessage } : {}),
          ...(a.metadata?.durationSeconds != null ? { duration_seconds: a.metadata.durationSeconds } : {}),
        },
      })),
      enabled: input.enabled,
      exempt_roles: input.exemptRoles,
      exempt_channels: input.exemptChannels,
    };
    const rule = (await this.rest.post(Routes.guildAutoModerationRules(this.guildId), { body })) as Json;
    return rule.id;
  }

  async setGuildPointers(input: {
    systemChannelId?: string | null;
    rulesChannelId?: string | null;
    publicUpdatesChannelId?: string | null;
    afkChannelId?: string | null;
  }): Promise<void> {
    const body: Json = {};
    if (input.systemChannelId !== undefined) body.system_channel_id = input.systemChannelId;
    if (input.rulesChannelId !== undefined) body.rules_channel_id = input.rulesChannelId;
    if (input.publicUpdatesChannelId !== undefined) body.public_updates_channel_id = input.publicUpdatesChannelId;
    if (input.afkChannelId !== undefined) body.afk_channel_id = input.afkChannelId;
    await this.rest.patch(Routes.guild(this.guildId), { body });
  }

  async setWelcomeScreen(input: RawWelcomeScreen): Promise<void> {
    await this.rest.patch(Routes.guildWelcomeScreen(this.guildId), {
      body: {
        enabled: input.enabled,
        description: input.description,
        welcome_channels: input.welcomeChannels.map((w) => ({
          channel_id: w.channelId,
          description: w.description,
          emoji_id: w.emojiId,
          emoji_name: w.emojiName,
        })),
      },
    });
  }

  async createWebhook(channelId: string, name: string): Promise<{ id: string; token: string }> {
    const hook = (await this.rest.post(Routes.channelWebhooks(channelId), { body: { name } })) as Json;
    return { id: hook.id, token: hook.token };
  }

  async executeWebhook(webhook: { id: string; token: string }, message: RawMessage): Promise<void> {
    await this.rest.post(Routes.webhook(webhook.id, webhook.token), {
      body: {
        username: message.author.username,
        avatar_url: message.author.avatarUrl ?? undefined,
        content: message.content || undefined,
        embeds: message.embeds.map((e) => ({
          title: e.title ?? undefined,
          description: e.description ?? undefined,
          url: e.url ?? undefined,
          color: e.color ?? undefined,
          author: e.author ?? undefined,
          footer: e.footer ? { text: e.footer.text, icon_url: e.footer.iconUrl } : undefined,
          image: e.image ?? undefined,
          thumbnail: e.thumbnail ?? undefined,
          timestamp: e.timestamp ?? undefined,
          fields: e.fields,
        })),
      },
      auth: false,
    });
  }

  async listExisting(kind: 'role' | 'channel' | 'emoji' | 'sticker' | 'automod'): Promise<Array<{ id: string; name: string }>> {
    switch (kind) {
      case 'role': return (await this.listRoles()).map((r) => ({ id: r.id, name: r.name }));
      case 'channel': return (await this.listChannels()).map((c) => ({ id: c.id, name: c.name }));
      case 'emoji': return (await this.listEmojis()).map((e) => ({ id: e.id, name: e.name }));
      case 'sticker': return (await this.listStickers()).map((s) => ({ id: s.id, name: s.name }));
      case 'automod': return (await this.listAutoModRules()).map((a) => ({ id: a.id, name: a.name }));
    }
  }
}

function summarizeComponents(rows: Json[]): string[] {
  const out: string[] = [];
  for (const row of rows) {
    for (const comp of row.components ?? []) {
      if (comp.type === 2) out.push(`button: ${comp.label ?? comp.custom_id ?? 'link'}`);
      else if (comp.type === 3) out.push(`select: ${comp.custom_id ?? 'menu'}`);
    }
  }
  return out;
}

function snakeTriggerMeta(m: Record<string, unknown>): Json {
  const t = m as Json;
  const out: Json = {};
  if (t.keywordFilter?.length) out.keyword_filter = t.keywordFilter;
  if (t.regexPatterns?.length) out.regex_patterns = t.regexPatterns;
  if (t.presets?.length) out.presets = t.presets;
  if (t.allowList?.length) out.allow_list = t.allowList;
  if (t.mentionTotalLimit != null) out.mention_total_limit = t.mentionTotalLimit;
  if (t.mentionRaidProtectionEnabled) out.mention_raid_protection_enabled = true;
  return out;
}
