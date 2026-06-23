/**
 * The abstract Discord surface the capture & rebuild engines speak to. Two implementations live in
 * `@disco/sdk`: an in-memory **MockGuild** (used by tests and safe dry-runs) and a real **discord.js
 * v14** client (the live-gated one). Keeping the engines behind these ports is what lets the entire
 * snapshot → dry-run → build → report path be proven with zero Discord credentials.
 *
 * Raw types here mirror the Discord REST shapes but use snowflake `id` strings; the capture engine
 * converts them into the localRef-based Snapshot.
 */

export interface RawRoleColors {
  primary: number;
  secondary: number | null;
  tertiary: number | null;
}

export interface RawRole {
  id: string;
  name: string;
  colors: RawRoleColors;
  hoist: boolean;
  position: number;
  permissions: string;
  managed: boolean;
  mentionable: boolean;
  iconUrl?: string | null;
  unicodeEmoji?: string | null;
  tags?: {
    botId?: string;
    integrationId?: string;
    premiumSubscriber?: boolean;
  };
}

export interface RawOverwrite {
  /** Target snowflake (role or member id). */
  id: string;
  /** 0 = role, 1 = member (Discord's overwrite type enum). */
  type: 0 | 1;
  allow: string;
  deny: string;
}

export interface RawChannel {
  id: string;
  /** discord.js ChannelType number. */
  type: number;
  name: string;
  parentId: string | null;
  position: number;
  topic?: string | null;
  nsfw?: boolean;
  rateLimitPerUser?: number;
  bitrate?: number | null;
  userLimit?: number | null;
  rtcRegion?: string | null;
  videoQualityMode?: number | null;
  availableTags?: Array<{
    id: string;
    name: string;
    moderated: boolean;
    emojiId: string | null;
    emojiName: string | null;
  }>;
  defaultReactionEmoji?: { emojiId: string | null; emojiName: string | null } | null;
  defaultForumLayout?: number | null;
  defaultSortOrder?: number | null;
  defaultThreadRateLimitPerUser?: number | null;
  defaultAutoArchiveDuration?: number | null;
  permissionOverwrites: RawOverwrite[];
}

export interface RawEmoji {
  id: string;
  name: string;
  animated: boolean;
  managed: boolean;
  roleIds: string[];
  imageUrl: string;
}

export interface RawSticker {
  id: string;
  name: string;
  description: string | null;
  tags: string;
  formatType: number;
  imageUrl: string;
}

export interface RawAutoModRule {
  id: string;
  name: string;
  eventType: number;
  triggerType: number;
  triggerMetadata: Record<string, unknown>;
  actions: Array<{
    type: number;
    metadata?: { channelId?: string; customMessage?: string; durationSeconds?: number };
  }>;
  enabled: boolean;
  exemptRoles: string[];
  exemptChannels: string[];
}

export interface RawBot {
  id: string;
  username: string;
  /** Discord application id, used for vendor recognition. */
  applicationId: string | null;
}

export interface RawEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}
export interface RawEmbed {
  title?: string | null;
  description?: string | null;
  url?: string | null;
  color?: number | null;
  author?: { name?: string; url?: string; iconUrl?: string } | null;
  footer?: { text?: string; iconUrl?: string } | null;
  image?: { url?: string } | null;
  thumbnail?: { url?: string } | null;
  timestamp?: string | null;
  fields?: RawEmbedField[];
}
export interface RawMessage {
  id: string;
  author: { username: string; avatarUrl: string | null; bot: boolean };
  content: string;
  embeds: RawEmbed[];
  pinned: boolean;
  /** Visual summary of any button/select rows (for fidelity + manual-step flagging). */
  componentSummary: string[];
  createdAt: string | null;
}

export interface RawWelcomeChannel {
  channelId: string;
  description: string;
  emojiId: string | null;
  emojiName: string | null;
}
export interface RawWelcomeScreen {
  enabled: boolean;
  description: string | null;
  welcomeChannels: RawWelcomeChannel[];
}

export interface RawGuildSettings {
  id: string;
  name: string;
  verificationLevel: number;
  defaultMessageNotifications: number;
  explicitContentFilter: number;
  afkChannelId: string | null;
  afkTimeout: number;
  systemChannelId: string | null;
  systemChannelFlags: number;
  rulesChannelId: string | null;
  publicUpdatesChannelId: string | null;
  preferredLocale: string;
  premiumTier: number;
  iconUrl: string | null;
  bannerUrl: string | null;
  splashUrl: string | null;
  discoverySplashUrl: string | null;
}

/** Reads needed to build a Snapshot from a source guild. */
export interface CapturePort {
  getGuild(): Promise<RawGuildSettings>;
  getWelcomeScreen(): Promise<RawWelcomeScreen | null>;
  listRoles(): Promise<RawRole[]>;
  listChannels(): Promise<RawChannel[]>;
  listEmojis(): Promise<RawEmoji[]>;
  listStickers(): Promise<RawSticker[]>;
  listAutoModRules(): Promise<RawAutoModRule[]>;
  listBots(): Promise<RawBot[]>;
  fetchMessages(channelId: string): Promise<RawMessage[]>;
  /** Download an asset by url and persist its bytes; returns the object-storage AssetKey. */
  persistAsset(url: string): Promise<string>;
}

export interface CreateChannelInput {
  type: number;
  name: string;
  parentId: string | null;
  position: number;
  topic?: string | null;
  nsfw?: boolean;
  rateLimitPerUser?: number;
  bitrate?: number | null;
  userLimit?: number | null;
  rtcRegion?: string | null;
  videoQualityMode?: number | null;
  availableTags?: RawChannel['availableTags'];
  defaultReactionEmoji?: RawChannel['defaultReactionEmoji'];
  defaultForumLayout?: number | null;
  defaultSortOrder?: number | null;
  defaultThreadRateLimitPerUser?: number | null;
  defaultAutoArchiveDuration?: number | null;
}

/** Writes needed to rebuild a snapshot into a target guild. */
export interface ApplyPort {
  modifyGuild(patch: Partial<RawGuildSettings> & { iconKey?: string; bannerKey?: string; splashKey?: string }): Promise<void>;
  getEveryoneRoleId(): Promise<string>;
  editEveryone(permissions: string): Promise<void>;
  createRole(input: {
    name: string;
    colors: RawRoleColors;
    hoist: boolean;
    mentionable: boolean;
    permissions: string;
    iconKey?: string | null;
    unicodeEmoji?: string | null;
  }): Promise<string>;
  editRole(id: string, input: Partial<{ name: string; colors: RawRoleColors; hoist: boolean; mentionable: boolean; permissions: string }>): Promise<void>;
  reorderRoles(orderedIds: string[]): Promise<void>;
  createEmoji(input: { name: string; imageKey: string; roleIds: string[] }): Promise<string>;
  createSticker(input: { name: string; description: string | null; tags: string; imageKey: string }): Promise<string>;
  createChannel(input: CreateChannelInput): Promise<string>;
  setChannelOverwrites(channelId: string, overwrites: RawOverwrite[]): Promise<void>;
  createAutoModRule(input: Omit<RawAutoModRule, 'id'>): Promise<string>;
  setGuildPointers(input: {
    systemChannelId?: string | null;
    rulesChannelId?: string | null;
    publicUpdatesChannelId?: string | null;
    afkChannelId?: string | null;
  }): Promise<void>;
  setWelcomeScreen(input: RawWelcomeScreen): Promise<void>;
  /** Create a webhook in a channel for content copy; returns its id+token. */
  createWebhook(channelId: string, name: string): Promise<{ id: string; token: string }>;
  executeWebhook(webhook: { id: string; token: string }, message: RawMessage): Promise<void>;
  /**
   * Existing target objects of a kind, by id+name — drives idempotent reconciliation. `category` and
   * `channel` are DISTINCT keyspaces (on Discord a category is a channel of type 4, so they must not
   * share a name-keyspace or a category could adopt a channel's id by name).
   */
  listExisting(kind: 'role' | 'category' | 'channel' | 'emoji' | 'sticker' | 'automod'): Promise<Array<{ id: string; name: string }>>;
}
