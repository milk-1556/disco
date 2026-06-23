import { z } from 'zod';
import { AssetKey, LocalRef, Snowflake } from './primitives.js';

/** Up to 5 channel cards shown on the community welcome screen. */
export const WelcomeChannel = z.object({
  channelRef: LocalRef,
  description: z.string().max(50),
  emojiUnicode: z.string().nullable().default(null),
  emojiRef: LocalRef.nullable().default(null),
});

export const WelcomeScreen = z.object({
  enabled: z.boolean().default(false),
  description: z.string().max(140).nullable().default(null),
  welcomeChannels: z.array(WelcomeChannel).max(5).default([]),
});
export type WelcomeScreen = z.infer<typeof WelcomeScreen>;

export const GuildAssets = z.object({
  icon: AssetKey.optional(),
  banner: AssetKey.optional(),
  splash: AssetKey.optional(),
  discoverySplash: AssetKey.optional(),
});

/** Top-level guild settings applied via Modify Guild on rebuild (§6 step 1). */
export const GuildSettings = z.object({
  name: z.string().min(2).max(100),
  sourceGuildId: Snowflake.optional(),
  /** 0 none, 1 low, 2 medium, 3 high, 4 very_high. */
  verificationLevel: z.number().int().min(0).max(4).default(0),
  /** 0 all messages, 1 only mentions. */
  defaultMessageNotifications: z.number().int().min(0).max(1).default(0),
  /** 0 disabled, 1 members without roles, 2 all members. */
  explicitContentFilter: z.number().int().min(0).max(2).default(0),
  afkChannelRef: LocalRef.nullable().default(null),
  afkTimeout: z.number().int().min(60).max(3600).default(300),
  systemChannelRef: LocalRef.nullable().default(null),
  /** Bitfield of suppressed system-channel messages. */
  systemChannelFlags: z.number().int().min(0).default(0),
  rulesChannelRef: LocalRef.nullable().default(null),
  publicUpdatesChannelRef: LocalRef.nullable().default(null),
  preferredLocale: z.string().default('en-US'),
  /** 0 none, 1 tier1, 2 tier2, 3 tier3 — captured for context; not settable via API. */
  premiumTier: z.number().int().min(0).max(3).default(0),
  assets: GuildAssets.default({}),
  welcomeScreen: WelcomeScreen.optional(),
});
export type GuildSettings = z.infer<typeof GuildSettings>;
