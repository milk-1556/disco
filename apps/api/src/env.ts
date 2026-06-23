/** Centralized env access. Never log secrets. Everything has a safe demo default so the API boots
 * with zero configuration (tokenless MockGuild demo mode). */
export const env = {
  host: process.env.API_HOST ?? '0.0.0.0',
  port: Number(process.env.API_PORT ?? 4000),
  sessionSecret: process.env.SESSION_SECRET ?? 'dev-insecure-session-secret-change-me',
  operatorEmail: process.env.OPERATOR_EMAIL ?? 'operator@disco.local',
  /** bcrypt hash of the operator password; when empty, dev login accepts password "disco". */
  operatorPasswordHash: process.env.OPERATOR_PASSWORD_HASH ?? '',
  discordBotToken: process.env.DISCORD_BOT_TOKEN ?? '',
  discordApplicationId: process.env.DISCORD_APPLICATION_ID ?? '',
  storageDiskPath: process.env.STORAGE_DISK_PATH ?? './storage',
  webOrigin: process.env.WEB_ORIGIN ?? '*',
};

/** Live mode requires a real bot token; otherwise the API runs the safe in-memory demo. */
export const isLiveMode = (): boolean => env.discordBotToken.length > 0;
