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

/**
 * An in-memory Discord guild implementing both the CapturePort (reads) and ApplyPort (writes). This
 * is the safe substrate for the entire snapshot → dry-run → build → report path: tests and dry runs
 * exercise the real engines with zero Discord credentials and zero risk to a live server.
 */
export class MockGuild implements CapturePort, ApplyPort {
  guild: RawGuildSettings;
  roles = new Map<string, RawRole>();
  channels = new Map<string, RawChannel>();
  emojis = new Map<string, RawEmoji>();
  stickers = new Map<string, RawSticker>();
  automod = new Map<string, RawAutoModRule>();
  bots = new Map<string, RawBot>();
  messages = new Map<string, RawMessage[]>();
  welcomeScreen: RawWelcomeScreen | null = null;
  assets = new Set<string>();
  webhooks = new Map<string, { channelId: string }>();
  /** Messages posted via webhook, per channel id — for assertions on content copy. */
  posted = new Map<string, RawMessage[]>();

  private seq = 1000;

  constructor(guildId = '900000000000000000', name = 'New Guild') {
    this.guild = {
      id: guildId,
      name,
      verificationLevel: 0,
      defaultMessageNotifications: 0,
      explicitContentFilter: 0,
      afkChannelId: null,
      afkTimeout: 300,
      systemChannelId: null,
      systemChannelFlags: 0,
      rulesChannelId: null,
      publicUpdatesChannelId: null,
      preferredLocale: 'en-US',
      premiumTier: 0,
      iconUrl: null,
      bannerUrl: null,
      splashUrl: null,
      discoverySplashUrl: null,
    };
    // Every guild starts with an @everyone role whose id equals the guild id.
    this.roles.set(guildId, {
      id: guildId,
      name: '@everyone',
      colors: { primary: 0, secondary: null, tertiary: null },
      hoist: false,
      position: 0,
      permissions: '104324673',
      managed: false,
      mentionable: false,
    });
  }

  private nextId(): string {
    return String(900000000000000000n + BigInt(this.seq++));
  }

  // ─────────────────────────────── CapturePort ───────────────────────────────
  async getGuild(): Promise<RawGuildSettings> {
    return { ...this.guild };
  }
  async getWelcomeScreen(): Promise<RawWelcomeScreen | null> {
    return this.welcomeScreen ? structuredClone(this.welcomeScreen) : null;
  }
  async listRoles(): Promise<RawRole[]> {
    return [...this.roles.values()].map((r) => structuredClone(r));
  }
  async listChannels(): Promise<RawChannel[]> {
    return [...this.channels.values()].map((c) => structuredClone(c));
  }
  async listEmojis(): Promise<RawEmoji[]> {
    return [...this.emojis.values()].map((e) => structuredClone(e));
  }
  async listStickers(): Promise<RawSticker[]> {
    return [...this.stickers.values()].map((s) => structuredClone(s));
  }
  async listAutoModRules(): Promise<RawAutoModRule[]> {
    return [...this.automod.values()].map((a) => structuredClone(a));
  }
  async listBots(): Promise<RawBot[]> {
    return [...this.bots.values()].map((b) => ({ ...b }));
  }
  async fetchMessages(channelId: string): Promise<RawMessage[]> {
    return (this.messages.get(channelId) ?? []).map((m) => structuredClone(m));
  }
  async persistAsset(url: string): Promise<string> {
    // Deterministic content-addressed key from the url (stand-in for hashing the bytes).
    let h = 0;
    for (let i = 0; i < url.length; i++) h = (Math.imul(31, h) + url.charCodeAt(i)) | 0;
    const key = `assets/${(h >>> 0).toString(16).padStart(8, '0')}.png`;
    this.assets.add(key);
    return key;
  }

  // ──────────────────────────────── ApplyPort ────────────────────────────────
  async modifyGuild(
    patch: Partial<RawGuildSettings> & { iconKey?: string; bannerKey?: string; splashKey?: string },
  ): Promise<void> {
    const { iconKey, bannerKey, splashKey, ...rest } = patch;
    Object.assign(this.guild, rest);
    if (iconKey) this.guild.iconUrl = `mock://asset/${iconKey}`;
    if (bannerKey) this.guild.bannerUrl = `mock://asset/${bannerKey}`;
    if (splashKey) this.guild.splashUrl = `mock://asset/${splashKey}`;
  }
  async getEveryoneRoleId(): Promise<string> {
    return this.guild.id;
  }
  async editEveryone(permissions: string): Promise<void> {
    const e = this.roles.get(this.guild.id);
    if (e) e.permissions = permissions;
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
    const id = this.nextId();
    this.roles.set(id, {
      id,
      name: input.name,
      colors: input.colors,
      hoist: input.hoist,
      mentionable: input.mentionable,
      permissions: input.permissions,
      managed: false,
      position: this.roles.size,
      unicodeEmoji: input.unicodeEmoji ?? null,
    });
    return id;
  }
  async editRole(
    id: string,
    input: Partial<{ name: string; colors: RawRoleColors; hoist: boolean; mentionable: boolean; permissions: string }>,
  ): Promise<void> {
    const r = this.roles.get(id);
    if (r) Object.assign(r, input);
  }
  async reorderRoles(orderedIds: string[]): Promise<void> {
    orderedIds.forEach((id, i) => {
      const r = this.roles.get(id);
      if (r) r.position = i + 1; // @everyone stays at 0
    });
  }
  async createEmoji(input: { name: string; imageKey: string; roleIds: string[] }): Promise<string> {
    const id = this.nextId();
    this.emojis.set(id, { id, name: input.name, animated: false, managed: false, roleIds: input.roleIds, imageUrl: `mock://asset/${input.imageKey}` });
    return id;
  }
  async createSticker(input: { name: string; description: string | null; tags: string; imageKey: string }): Promise<string> {
    const id = this.nextId();
    this.stickers.set(id, { id, name: input.name, description: input.description, tags: input.tags, formatType: 1, imageUrl: `mock://asset/${input.imageKey}` });
    return id;
  }
  async createChannel(input: CreateChannelInput): Promise<string> {
    const id = this.nextId();
    this.channels.set(id, {
      id,
      type: input.type,
      name: input.name,
      parentId: input.parentId,
      position: input.position,
      topic: input.topic ?? null,
      nsfw: input.nsfw ?? false,
      rateLimitPerUser: input.rateLimitPerUser ?? 0,
      bitrate: input.bitrate ?? null,
      userLimit: input.userLimit ?? null,
      rtcRegion: input.rtcRegion ?? null,
      videoQualityMode: input.videoQualityMode ?? null,
      availableTags: input.availableTags ?? [],
      defaultReactionEmoji: input.defaultReactionEmoji ?? null,
      defaultForumLayout: input.defaultForumLayout ?? null,
      defaultSortOrder: input.defaultSortOrder ?? null,
      defaultThreadRateLimitPerUser: input.defaultThreadRateLimitPerUser ?? null,
      defaultAutoArchiveDuration: input.defaultAutoArchiveDuration ?? null,
      permissionOverwrites: [],
    });
    return id;
  }
  async setChannelOverwrites(channelId: string, overwrites: RawOverwrite[]): Promise<void> {
    const c = this.channels.get(channelId);
    if (c) c.permissionOverwrites = overwrites;
  }
  async createAutoModRule(input: Omit<RawAutoModRule, 'id'>): Promise<string> {
    const id = this.nextId();
    this.automod.set(id, { id, ...input });
    return id;
  }
  async setGuildPointers(input: {
    systemChannelId?: string | null;
    rulesChannelId?: string | null;
    publicUpdatesChannelId?: string | null;
    afkChannelId?: string | null;
  }): Promise<void> {
    if (input.systemChannelId !== undefined) this.guild.systemChannelId = input.systemChannelId;
    if (input.rulesChannelId !== undefined) this.guild.rulesChannelId = input.rulesChannelId;
    if (input.publicUpdatesChannelId !== undefined) this.guild.publicUpdatesChannelId = input.publicUpdatesChannelId;
    if (input.afkChannelId !== undefined) this.guild.afkChannelId = input.afkChannelId;
  }
  async setWelcomeScreen(input: RawWelcomeScreen): Promise<void> {
    this.welcomeScreen = structuredClone(input);
  }
  async createWebhook(channelId: string, _name: string): Promise<{ id: string; token: string }> {
    const id = this.nextId();
    this.webhooks.set(id, { channelId });
    return { id, token: `tok_${id}` };
  }
  async executeWebhook(webhook: { id: string; token: string }, message: RawMessage): Promise<void> {
    const hook = this.webhooks.get(webhook.id);
    if (!hook) return;
    const list = this.posted.get(hook.channelId) ?? [];
    list.push(structuredClone(message));
    this.posted.set(hook.channelId, list);
  }
  async listExisting(kind: 'role' | 'channel' | 'emoji' | 'sticker' | 'automod'): Promise<Array<{ id: string; name: string }>> {
    const src =
      kind === 'role' ? this.roles
      : kind === 'channel' ? this.channels
      : kind === 'emoji' ? this.emojis
      : kind === 'sticker' ? this.stickers
      : this.automod;
    return [...src.values()].map((o) => ({ id: o.id, name: o.name }));
  }
}
