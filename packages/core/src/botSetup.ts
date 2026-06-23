import type { BotSetupEntry, DetectedBot } from '@disco/schema';
import { recognizeVendor } from './snapshot/vendors.js';

/**
 * The permission set a typical management bot needs to re-do its job (roles, channels, messages,
 * webhooks, expressions, basic moderation). Pre-baked into the re-invite URL so the operator doesn't
 * hand-pick permissions. The operator can still trim it in Discord's OAuth screen.
 */
const MANAGEMENT_PERMS = (
  (1n << 1n) | // KICK_MEMBERS
  (1n << 2n) | // BAN_MEMBERS
  (1n << 4n) | // MANAGE_CHANNELS
  (1n << 5n) | // MANAGE_GUILD
  (1n << 6n) | // ADD_REACTIONS
  (1n << 10n) | // VIEW_CHANNEL
  (1n << 11n) | // SEND_MESSAGES
  (1n << 13n) | // MANAGE_MESSAGES
  (1n << 14n) | // EMBED_LINKS
  (1n << 16n) | // READ_MESSAGE_HISTORY
  (1n << 28n) | // MANAGE_ROLES
  (1n << 29n) | // MANAGE_WEBHOOKS
  (1n << 30n) // MANAGE_GUILD_EXPRESSIONS
).toString();

/** Turn a recognized capability into a concrete, paste-ready reconfiguration step. */
function reconfigureStep(note: string): string {
  const key = note.toLowerCase();
  const map: Record<string, string> = {
    'reaction roles': 'Recreate the reaction-role / button-role panels — they were copied visually but stay inert until this bot owns them again.',
    'welcome messages': 'Re-set the welcome message and welcome channel.',
    'welcome images': 'Re-upload the welcome image/banner and pick the welcome channel.',
    tickets: 'Recreate the ticket panel and its category/permissions.',
    'ticket panels': 'Recreate the ticket panel and its category/permissions.',
    leveling: 'Re-enable leveling and re-add the level-up role rewards.',
    moderation: 'Re-apply auto-mod / moderation rules and the mod-log channel.',
    logging: 'Point logging at the new log channel.',
    'auto-roles': 'Re-set the auto-role(s) granted on join.',
    'auto-responders': 'Re-create the auto-responder triggers.',
    'custom commands': 'Re-import or re-create the custom commands.',
    giveaways: 'Re-schedule any active giveaways.',
    'paid memberships': 'Reconnect the paid-membership product(s) and the gated roles.',
    'role gating': 'Re-map purchased products to the gated roles.',
    checkout: 'Re-link the checkout/landing pages to the new server.',
    embeds: 'Re-publish any bot-managed embeds (they were copied as static text).',
  };
  return map[key] ?? `Reconfigure: ${note}.`;
}

/**
 * Build the actionable Bot Setup Checklist from detected bots (§6 step 10). Each entry gets a real
 * OAuth re-invite URL (the bot's own application id + the perms it typically needs) so re-adding it
 * is one click, plus concrete reconfigure steps for the features Disco can't clone.
 */
export function generateBotSetup(bots: DetectedBot[]): BotSetupEntry[] {
  return bots.map((b): BotSetupEntry => {
    const v = recognizeVendor(b.sourceId ?? null, b.name);
    const oauthUrl = b.sourceId
      ? `https://discord.com/oauth2/authorize?client_id=${b.sourceId}&scope=bot+applications.commands&permissions=${MANAGEMENT_PERMS}`
      : null;
    const notes = b.reconfigureNotes.length ? b.reconfigureNotes : (v?.notes ?? []);
    return {
      name: b.name,
      vendor: b.vendorGuess ?? v?.vendor ?? null,
      oauthUrl,
      dashboardUrl: b.inviteUrl ?? v?.inviteUrl ?? null,
      permissions: MANAGEMENT_PERMS,
      reconfigure: notes.map(reconfigureStep),
    };
  });
}

/** Render the Bot Setup Checklist as Markdown the operator can paste straight to the client. */
export function botSetupMarkdown(entries: BotSetupEntry[]): string {
  if (!entries.length) return '_No third-party bots detected — nothing to re-invite._';
  return entries
    .map((e) => {
      const head = `### ${e.name}${e.vendor && e.vendor !== e.name ? ` · ${e.vendor}` : ''}`;
      const lines = [head];
      if (e.oauthUrl) lines.push(`- **Re-invite:** ${e.oauthUrl}`);
      if (e.dashboardUrl) lines.push(`- **Configure at:** ${e.dashboardUrl}`);
      for (const r of e.reconfigure) lines.push(`- ${r}`);
      return lines.join('\n');
    })
    .join('\n\n');
}
