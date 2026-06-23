/** Discord permission bits Disco actually uses, plus the OAuth invite-URL generator (§8/§9). */

export const ADMINISTRATOR = 1n << 3n;

/** The minimal granular permission set for a clean clone (alternative to Administrator). */
export function granularPermissionInteger(): string {
  const bits =
    (1n << 4n) | // MANAGE_CHANNELS
    (1n << 5n) | // MANAGE_GUILD
    (1n << 10n) | // VIEW_CHANNEL
    (1n << 13n) | // MANAGE_MESSAGES
    (1n << 16n) | // READ_MESSAGE_HISTORY
    (1n << 28n) | // MANAGE_ROLES
    (1n << 29n) | // MANAGE_WEBHOOKS
    (1n << 30n) | // MANAGE_GUILD_EXPRESSIONS
    (1n << 15n); // MENTION_EVERYONE (welcome screen / announcements parity)
  return bits.toString();
}

export interface InviteUrlInput {
  applicationId: string;
  /** Use Administrator (recommended for a clean clone) or the granular set. */
  mode?: 'administrator' | 'granular';
  guildId?: string;
}

export function buildInviteUrl(input: InviteUrlInput): { url: string; permissions: string; mode: string } {
  const permissions = input.mode === 'granular' ? granularPermissionInteger() : ADMINISTRATOR.toString();
  const params = new URLSearchParams({
    client_id: input.applicationId,
    permissions,
    scope: 'bot applications.commands',
  });
  if (input.guildId) params.set('guild_id', input.guildId);
  return {
    url: `https://discord.com/oauth2/authorize?${params.toString()}`,
    permissions,
    mode: input.mode ?? 'administrator',
  };
}
