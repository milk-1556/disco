import type { Channel, CopyPolicy, Snapshot } from '@disco/schema';

/** Discord "Send Messages" permission bit (1 << 11). A read-only info channel denies this to @everyone. */
const SEND_MESSAGES = 1n << 11n;

/** Names that strongly indicate a system/info channel whose content is safe & useful to copy (§5). */
const SYSTEM_NAME_RE =
  /(rules?|verif|info|start|read-?me|announce|welcome|roles?|role-?select|faq|links?|partners?|how-?to|guide|begin|getting-?started|onboard|terms|tos)/i;

export interface Classification {
  policy: CopyPolicy;
  copyContent: boolean;
  /** Why it was classified this way — surfaced in the per-channel UI. */
  reason: string;
}

/**
 * Classify a single channel as system_content vs member_chat (§5). system_content when the name
 * matches the info-channel pattern OR @everyone has Send Messages denied (a read-only info channel).
 * Everything else is member_chat and its content is NEVER copied. `copyContent` defaults to ON for
 * system_content, OFF for member_chat — the operator can still override per channel.
 */
export function classifyChannel(channel: Channel, everyoneRef: string | null): Classification {
  // Voice/stage/category have no copyable message content.
  if (channel.kind === 'voice' || channel.kind === 'stage' || channel.kind === 'category') {
    return { policy: 'member_chat', copyContent: false, reason: 'no text content' };
  }

  if (SYSTEM_NAME_RE.test(channel.name)) {
    return { policy: 'system_content', copyContent: true, reason: `name matches info pattern` };
  }

  if (everyoneRef) {
    const ow = channel.overwrites.find(
      (o) => o.targetType === 'role' && o.targetRef === everyoneRef,
    );
    if (ow) {
      try {
        if ((BigInt(ow.deny) & SEND_MESSAGES) === SEND_MESSAGES) {
          return {
            policy: 'system_content',
            copyContent: true,
            reason: 'read-only for @everyone (Send Messages denied)',
          };
        }
      } catch {
        /* malformed bitfield — fall through */
      }
    }
  }

  return { policy: 'member_chat', copyContent: false, reason: 'ordinary chat channel' };
}

/** Find the @everyone role's localRef in a snapshot, if present. */
export function findEveryoneRef(snap: Snapshot): string | null {
  return snap.roles.find((r) => r.isEveryone)?.localRef ?? null;
}

/**
 * Classify every channel in a snapshot, returning a new snapshot with `copyPolicy`/`copyContent`
 * set. Does not mutate the input. Used at snapshot time to seed the per-channel toggles.
 */
export function classifyChannels(snap: Snapshot): Snapshot {
  const everyoneRef = findEveryoneRef(snap);
  const next = structuredClone(snap);
  next.channels = next.channels.map((ch) => {
    const { policy, copyContent } = classifyChannel(ch, everyoneRef);
    return { ...ch, copyPolicy: policy, copyContent };
  });
  return next;
}
