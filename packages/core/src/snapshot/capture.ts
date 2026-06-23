import type {
  AutoModRule,
  Category,
  Channel,
  ChannelContent,
  DetectedBot,
  Emoji,
  PermissionOverwrite,
  Role,
  Snapshot,
  Sticker,
} from '@disco/schema';
import { SCHEMA_VERSION, Snapshot as SnapshotSchema } from '@disco/schema';
import { classifyChannel } from '../classify/channelPolicy.js';
import { extractBrandTokens } from '../extract/brandTokens.js';
import type { CapturePort, RawChannel, RawEmbed, RawMessage } from '../ports.js';
import { mentionsToRefs, RefAllocator } from './refs.js';
import { recognizeVendor } from './vendors.js';

/** discord.js ChannelType number → our ChannelKind. Returns null for non-clonable kinds (threads). */
function kindOfType(type: number): Channel['kind'] | null {
  switch (type) {
    case 0: return 'text';
    case 2: return 'voice';
    case 4: return 'category';
    case 5: return 'announcement';
    case 13: return 'stage';
    case 15: return 'forum';
    case 16: return 'media';
    default: return null; // threads (10/11/12), directory, etc. — not structure
  }
}

export interface CaptureOptions {
  /** Source guild display name + operator note recorded on the snapshot. */
  ownerNote?: string;
  /** Cap on messages copied per system channel (oldest→newest). */
  maxMessagesPerChannel?: number;
}

/**
 * Capture a source guild into a typed, portable Snapshot (§3). Assigns stable localRefs to every
 * object, translates all cross-references (overwrites, pointers, mentions, automod exemptions) into
 * localRefs, classifies channels, detects third-party bots, copies system-channel content, and
 * auto-extracts brand tokens. Pure with respect to Discord — all I/O goes through the CapturePort,
 * so it runs identically against the MockGuild and the real client.
 */
export async function captureSnapshot(port: CapturePort, opts: CaptureOptions = {}): Promise<Snapshot> {
  const refs = new RefAllocator();
  const guild = await port.getGuild();

  // ── Roles ──
  const rawRoles = (await port.listRoles()).slice().sort((a, b) => a.position - b.position);
  const roleIdToRef = new Map<string, string>();
  const roles: Role[] = rawRoles.map((r) => {
    const isEveryone = r.id === guild.id || r.name === '@everyone';
    const ref = isEveryone ? 'role_everyone' : refs.alloc('role', r.name);
    roleIdToRef.set(r.id, ref);
    return {
      localRef: ref,
      sourceId: r.id,
      name: r.name,
      isEveryone,
      colors: r.colors,
      hoist: r.hoist,
      position: r.position,
      permissions: r.permissions,
      mentionable: r.mentionable,
      managed: r.managed,
      ...(r.tags ? { tags: r.tags } : {}),
      ...(r.unicodeEmoji ? { unicodeEmoji: r.unicodeEmoji } : {}),
    };
  });
  const everyoneRef = roles.find((r) => r.isEveryone)?.localRef ?? null;

  // ── Emojis & stickers (assets persisted to object storage) ──
  const emojiIdToRef = new Map<string, string>();
  const emojis: Emoji[] = [];
  for (const e of await port.listEmojis()) {
    const ref = refs.alloc('emoji', e.name);
    emojiIdToRef.set(e.id, ref);
    emojis.push({
      localRef: ref,
      sourceId: e.id,
      name: e.name,
      asset: await port.persistAsset(e.imageUrl),
      animated: e.animated,
      roleRefs: e.roleIds.map((id) => roleIdToRef.get(id)).filter((x): x is string => !!x),
      managed: e.managed,
    });
  }
  const stickers: Sticker[] = [];
  for (const s of await port.listStickers()) {
    stickers.push({
      localRef: refs.alloc('sticker', s.name),
      sourceId: s.id,
      name: s.name,
      description: s.description,
      tags: s.tags,
      asset: await port.persistAsset(s.imageUrl),
      formatType: s.formatType,
    });
  }

  // ── Channels & categories ──
  const rawChannels = (await port.listChannels()).slice().sort((a, b) => a.position - b.position);
  const channelIdToRef = new Map<string, string>();
  const categoryIdToRef = new Map<string, string>();
  const categories: Category[] = [];
  const channels: Channel[] = [];

  const mapOverwrites = (raw: RawChannel['permissionOverwrites']): PermissionOverwrite[] =>
    raw.map((o) => {
      const targetType = o.type === 1 ? ('member' as const) : ('role' as const);
      const targetRef =
        targetType === 'role'
          ? roleIdToRef.get(o.id) ?? `role_unknown_${o.id}`
          : `member_${o.id}`;
      return { targetType, targetRef, targetSourceId: o.id, allow: o.allow, deny: o.deny };
    });

  // First pass: categories (so channels can reference them).
  for (const c of rawChannels) {
    if (kindOfType(c.type) === 'category') {
      const ref = refs.alloc('cat', c.name);
      categoryIdToRef.set(c.id, ref);
      categories.push({ localRef: ref, sourceId: c.id, name: c.name, position: c.position, overwrites: mapOverwrites(c.permissionOverwrites) });
    }
  }
  // Second pass: real channels.
  for (const c of rawChannels) {
    const kind = kindOfType(c.type);
    if (!kind || kind === 'category') continue;
    const ref = refs.alloc('chan', c.name);
    channelIdToRef.set(c.id, ref);
    const base: Channel = {
      localRef: ref,
      sourceId: c.id,
      kind,
      name: c.name,
      categoryRef: c.parentId ? categoryIdToRef.get(c.parentId) ?? null : null,
      position: c.position,
      topic: c.topic ?? null,
      nsfw: c.nsfw ?? false,
      rateLimitPerUser: c.rateLimitPerUser ?? 0,
      bitrate: c.bitrate ?? null,
      userLimit: c.userLimit ?? null,
      rtcRegion: c.rtcRegion ?? null,
      videoQualityMode: c.videoQualityMode ?? null,
      forumTags: (c.availableTags ?? []).map((t) => ({
        localRef: refs.alloc('tag', t.name),
        name: t.name,
        moderated: t.moderated,
        emojiUnicode: t.emojiName,
        emojiRef: t.emojiId ? emojiIdToRef.get(t.emojiId) ?? null : null,
      })),
      defaultReaction: c.defaultReactionEmoji
        ? { emojiUnicode: c.defaultReactionEmoji.emojiName, emojiRef: c.defaultReactionEmoji.emojiId ? emojiIdToRef.get(c.defaultReactionEmoji.emojiId) ?? null : null }
        : null,
      defaultForumLayout: c.defaultForumLayout ?? null,
      defaultSortOrder: c.defaultSortOrder ?? null,
      defaultThreadRateLimitPerUser: c.defaultThreadRateLimitPerUser ?? null,
      defaultAutoArchiveDuration: (c.defaultAutoArchiveDuration as Channel['defaultAutoArchiveDuration']) ?? null,
      overwrites: mapOverwrites(c.permissionOverwrites),
      copyPolicy: 'member_chat',
      copyContent: false,
    };
    const cls = classifyChannel(base, everyoneRef);
    channels.push({ ...base, copyPolicy: cls.policy, copyContent: cls.copyContent });
  }

  // ── AutoMod ──
  const automod: AutoModRule[] = (await port.listAutoModRules()).map((r) => ({
    localRef: refs.alloc('am', r.name),
    sourceId: r.id,
    name: r.name,
    eventType: r.eventType as AutoModRule['eventType'],
    triggerType: r.triggerType as AutoModRule['triggerType'],
    triggerMetadata: r.triggerMetadata as AutoModRule['triggerMetadata'],
    actions: r.actions.map((a) => ({
      type: a.type as 1 | 2 | 3,
      customMessage: a.metadata?.customMessage ?? null,
      alertChannelRef: a.metadata?.channelId ? channelIdToRef.get(a.metadata.channelId) ?? null : null,
      durationSeconds: a.metadata?.durationSeconds ?? null,
    })),
    enabled: r.enabled,
    exemptRoleRefs: r.exemptRoles.map((id) => roleIdToRef.get(id)).filter((x): x is string => !!x),
    exemptChannelRefs: r.exemptChannels.map((id) => channelIdToRef.get(id)).filter((x): x is string => !!x),
  }));

  // ── Bot detection ──
  const bots: DetectedBot[] = (await port.listBots()).map((b) => {
    const v = recognizeVendor(b.applicationId, b.username);
    const ref = refs.alloc('bot', b.username);
    const traces = roles
      .filter((r) => r.managed && r.tags?.botId === b.id)
      .map((r) => ({ kind: 'managed_role' as const, where: `role: ${r.name}`, ref: r.localRef, detail: null }));
    return {
      localRef: ref,
      sourceId: b.id,
      name: b.username,
      vendorGuess: v?.vendor ?? null,
      inviteUrl: v?.inviteUrl ?? null,
      reconfigureNotes: v?.notes ?? [],
      configTraces: traces,
    };
  });

  // ── System-channel content (only for channels classified copyContent) ──
  const content: ChannelContent[] = [];
  const cap = opts.maxMessagesPerChannel ?? 200;
  for (const ch of channels) {
    if (!ch.copyContent || !ch.sourceId) continue;
    const raw = (await port.fetchMessages(ch.sourceId)).slice(0, cap);
    if (!raw.length) continue;
    let interactive = false;
    const messages = raw.map((m: RawMessage) => {
      if (m.componentSummary.length) interactive = true;
      return {
        sourceId: m.id,
        authorName: m.author.username,
        authorAvatarUrl: m.author.avatarUrl,
        authorIsBot: m.author.bot,
        content: mentionsToRefs(m.content, channelIdToRef, emojiIdToRef),
        embeds: m.embeds.map(mapEmbed),
        pinned: m.pinned,
        componentSummary: m.componentSummary,
        createdAt: m.createdAt,
      };
    });
    content.push({ channelRef: ch.localRef, messages, hasInteractiveComponents: interactive });
  }

  // ── Guild settings (pointers → refs, assets → keys) ──
  const ws = await port.getWelcomeScreen();
  const persist = async (url: string | null) => (url ? await port.persistAsset(url) : undefined);
  const iconKey = await persist(guild.iconUrl);
  const bannerKey = await persist(guild.bannerUrl);
  const splashKey = await persist(guild.splashUrl);
  const discoveryKey = await persist(guild.discoverySplashUrl);
  const assets: Snapshot['guild']['assets'] = {};
  if (iconKey) assets.icon = iconKey;
  if (bannerKey) assets.banner = bannerKey;
  if (splashKey) assets.splash = splashKey;
  if (discoveryKey) assets.discoverySplash = discoveryKey;
  const assembled: Snapshot = {
    schemaVersion: SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
    source: { guildId: guild.id, name: guild.name, ownerNote: opts.ownerNote ?? '' },
    guild: {
      name: guild.name,
      sourceGuildId: guild.id,
      verificationLevel: guild.verificationLevel,
      defaultMessageNotifications: guild.defaultMessageNotifications,
      explicitContentFilter: guild.explicitContentFilter,
      afkChannelRef: guild.afkChannelId ? channelIdToRef.get(guild.afkChannelId) ?? null : null,
      afkTimeout: guild.afkTimeout,
      systemChannelRef: guild.systemChannelId ? channelIdToRef.get(guild.systemChannelId) ?? null : null,
      systemChannelFlags: guild.systemChannelFlags,
      rulesChannelRef: guild.rulesChannelId ? channelIdToRef.get(guild.rulesChannelId) ?? null : null,
      publicUpdatesChannelRef: guild.publicUpdatesChannelId ? channelIdToRef.get(guild.publicUpdatesChannelId) ?? null : null,
      preferredLocale: guild.preferredLocale,
      premiumTier: guild.premiumTier,
      assets,
      ...(ws
        ? {
            welcomeScreen: {
              enabled: ws.enabled,
              description: ws.description,
              welcomeChannels: ws.welcomeChannels
                .map((wc) => {
                  const ref = channelIdToRef.get(wc.channelId);
                  return ref
                    ? { channelRef: ref, description: wc.description, emojiUnicode: wc.emojiName, emojiRef: wc.emojiId ? emojiIdToRef.get(wc.emojiId) ?? null : null }
                    : null;
                })
                .filter((x): x is NonNullable<typeof x> => !!x),
            },
          }
        : {}),
    },
    roles,
    categories,
    channels,
    emojis,
    stickers,
    automod,
    bots,
    content,
    brandTokens: [],
  };

  assembled.brandTokens = extractBrandTokens(assembled);
  // Validate the assembled artifact against the schema before returning.
  return SnapshotSchema.parse(assembled);
}

function mapEmbed(e: RawEmbed) {
  return {
    title: e.title ?? null,
    description: e.description ?? null,
    url: e.url ?? null,
    color: e.color ?? null,
    authorName: e.author?.name ?? null,
    authorUrl: e.author?.url ?? null,
    authorIconUrl: e.author?.iconUrl ?? null,
    footerText: e.footer?.text ?? null,
    footerIconUrl: e.footer?.iconUrl ?? null,
    imageUrl: e.image?.url ?? null,
    thumbnailUrl: e.thumbnail?.url ?? null,
    timestamp: e.timestamp ?? null,
    fields: (e.fields ?? []).map((f) => ({ name: f.name, value: f.value, inline: f.inline ?? false })),
  };
}
