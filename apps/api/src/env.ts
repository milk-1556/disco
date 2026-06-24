/** Centralized env access. Never log secrets. Everything has a safe demo default so the API boots
 * with zero configuration (tokenless MockGuild demo mode). */
const INSECURE_SESSION_DEFAULT = 'dev-insecure-session-secret-change-me';

export const env = {
  host: process.env.API_HOST ?? '0.0.0.0',
  port: Number(process.env.API_PORT ?? 4000),
  sessionSecret: process.env.SESSION_SECRET ?? INSECURE_SESSION_DEFAULT,
  operatorEmail: process.env.OPERATOR_EMAIL ?? 'operator@disco.local',
  /** bcrypt hash of the operator password; when empty, dev login accepts password "disco". */
  operatorPasswordHash: process.env.OPERATOR_PASSWORD_HASH ?? '',
  discordBotToken: process.env.DISCORD_BOT_TOKEN ?? '',
  discordApplicationId: process.env.DISCORD_APPLICATION_ID ?? '',
  storageDiskPath: process.env.STORAGE_DISK_PATH ?? './storage',
  webOrigin: process.env.WEB_ORIGIN ?? '*',
  /** When set → PrismaRepo (Postgres). Otherwise the zero-setup in-memory demo store. */
  databaseUrl: process.env.DATABASE_URL ?? '',
  /** When set → builds enqueue to BullMQ + logs go cross-process over Redis. Otherwise in-process. */
  redisUrl: process.env.REDIS_URL ?? '',
};

/** Live mode requires a real bot token; otherwise the API runs the safe in-memory demo. */
export const isLiveMode = (): boolean => env.discordBotToken.length > 0;

/** Persistence/queue switches — independent of demo/live Discord mode. */
export const usePrisma = (): boolean => env.databaseUrl.length > 0;
export const useQueue = (): boolean => env.redisUrl.length > 0;

/**
 * Refuse to boot a production-shaped deploy on the public dev secret. A real deploy is anything with
 * a live bot token, a Postgres DB, or NODE_ENV=production. There the SESSION_SECRET MUST be set and
 * not the publicly-known default — otherwise anyone could forge an operator JWT and bypass auth.
 * (Pure local in-memory demo still boots with zero config.)
 */
export function assertSecureEnv(): void {
  const productionShaped = process.env.NODE_ENV === 'production' || isLiveMode() || usePrisma();
  if (!productionShaped) return;
  if (!process.env.SESSION_SECRET || env.sessionSecret === INSECURE_SESSION_DEFAULT) {
    throw new Error(
      'SESSION_SECRET must be set to a strong, unique value before going to production (live token / Postgres / NODE_ENV=production). Refusing to boot on the public dev default. Generate one: `openssl rand -base64 48`.',
    );
  }
  if (env.sessionSecret.length < 32) {
    // eslint-disable-next-line no-console
    console.warn('[disco-api] WARNING: SESSION_SECRET is shorter than 32 chars — use a 32+ char random value in production.');
  }
}
