import { z } from 'zod';

/** One step in the Ownership Transfer Checklist (§7). */
export const OwnershipStep = z.object({
  title: z.string(),
  detail: z.string().default(''),
  done: z.boolean().default(false),
});
export type OwnershipStep = z.infer<typeof OwnershipStep>;

export const HandoverState = z.enum(['draft', 'ready', 'handed_over']);
export type HandoverState = z.infer<typeof HandoverState>;

export const UpsellStatus = z.enum(['none', 'proposed', 'retained', 'redesign']);
export type UpsellStatus = z.infer<typeof UpsellStatus>;

/**
 * The client delivery record for a completed build (§7): a per-job handover page with the included
 * scope, the Bot Setup Checklist (from the report), an Ownership Transfer Checklist, and an upsell
 * tracker. Optionally password-protected for sharing.
 */
export const Handover = z.object({
  id: z.string(),
  jobId: z.string(),
  clientId: z.string().nullable().default(null),
  state: HandoverState.default('draft'),
  /** Set when the page is password-protected; never returned to the client UI. */
  hasPassword: z.boolean().default(false),
  /** Per-client branding for the delivery page. */
  logoKey: z.string().nullable().default(null),
  welcomeMessage: z.string().default(''),
  /** The client's Discord invite link to their finished server — the primary action on the delivery
   *  page ("Open your server"). Operator-set; validated server-side to a Discord invite URL. Empty until set. */
  inviteUrl: z.string().default(''),
  ownershipSteps: z.array(OwnershipStep).default([]),
  upsellStatus: UpsellStatus.default('none'),
  /** The operator who owns this record (multi-operator access scoping). Defaults to the sole operator. */
  ownerEmail: z.string().default(''),
  /** Client survey (#4): a 0-10 NPS + an open comment, submitted once from the public handover page. */
  surveyNps: z.number().int().min(0).max(10).nullable().default(null),
  surveyComment: z.string().default(''),
  surveyAt: z.string().nullable().default(null),
  /** When the handover was first delivered (draft→ready/handed_over) — the engagement baseline (#3). */
  readyAt: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type Handover = z.infer<typeof Handover>;

/**
 * Discord only lets a server *owner* transfer ownership to a member who has 2FA enabled, so the flow
 * is: client joins → gets a temp admin role → operator transfers ownership → operator's bot/role is
 * removed. This is the default checklist seeded on every handover.
 */
export function defaultOwnershipSteps(): OwnershipStep[] {
  return [
    { title: 'Client joins the server', detail: 'Send the invite link; confirm they are in.', done: false },
    { title: 'Client enables 2FA on their Discord account', detail: 'Required by Discord before ownership can transfer.', done: false },
    { title: 'Grant the client a temporary Admin role', detail: 'So they can operate while you finish handover.', done: false },
    { title: 'Transfer server ownership to the client', detail: 'Server Settings → Members → ⋯ → Transfer Ownership.', done: false },
    { title: 'Client re-invites & configures the third-party bots', detail: 'Work through the Bot Setup Checklist below.', done: false },
    { title: 'Remove Disco’s bot and your operator role', detail: 'Clean exit once everything is verified.', done: false },
  ];
}
