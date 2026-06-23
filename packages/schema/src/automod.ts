import { z } from 'zod';
import { LocalRef, Snowflake } from './primitives.js';

/** AutoMod trigger type (Discord enum). */
export const AutoModTriggerType = z.union([
  z.literal(1), // KEYWORD
  z.literal(3), // SPAM
  z.literal(4), // KEYWORD_PRESET
  z.literal(5), // MENTION_SPAM
  z.literal(6), // MEMBER_PROFILE
]);

export const AutoModTriggerMetadata = z
  .object({
    keywordFilter: z.array(z.string()).default([]),
    regexPatterns: z.array(z.string()).default([]),
    presets: z.array(z.number().int()).default([]), // 1 profanity, 2 sexual content, 3 slurs
    allowList: z.array(z.string()).default([]),
    mentionTotalLimit: z.number().int().min(0).max(50).nullable().default(null),
    mentionRaidProtectionEnabled: z.boolean().default(false),
  })
  .partial()
  .default({});

/** A single AutoMod action. Alert-channel targets are rewritten through localRef maps on rebuild. */
export const AutoModAction = z.object({
  /** 1 BLOCK_MESSAGE, 2 SEND_ALERT_MESSAGE, 3 TIMEOUT. */
  type: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  customMessage: z.string().max(150).nullable().default(null),
  /** localRef of the alert channel (for SEND_ALERT_MESSAGE). */
  alertChannelRef: LocalRef.nullable().default(null),
  /** Timeout seconds (for TIMEOUT), max 2419200 (4 weeks). */
  durationSeconds: z.number().int().min(0).max(2419200).nullable().default(null),
});

export const AutoModRule = z.object({
  localRef: LocalRef,
  sourceId: Snowflake.optional(),
  name: z.string().max(100),
  /** 1 MESSAGE_SEND, 2 MEMBER_UPDATE. */
  eventType: z.union([z.literal(1), z.literal(2)]).default(1),
  triggerType: AutoModTriggerType,
  triggerMetadata: AutoModTriggerMetadata,
  actions: z.array(AutoModAction).default([]),
  enabled: z.boolean().default(true),
  exemptRoleRefs: z.array(LocalRef).default([]),
  exemptChannelRefs: z.array(LocalRef).default([]),
});
export type AutoModRule = z.infer<typeof AutoModRule>;
