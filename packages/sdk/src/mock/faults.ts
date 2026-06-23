import { DiscordRateLimitError, DiscordTransientError } from '@disco/core';

export interface FaultConfig {
  /** Every Nth faulted call returns a 429 with `retryAfterMs`. */
  rateLimitEvery?: number;
  retryAfterMs?: number;
  /** Every Nth faulted call returns a transient 5xx. */
  transientEvery?: number;
  transientStatus?: number;
  /** Restrict faulting to these method names (default: all methods). */
  only?: string[];
}

/**
 * Wrap a port so a deterministic fraction of calls fail like real Discord — 429 (with Retry-After)
 * and transient 5xx — BEFORE delegating to the real method. Because the counter advances on every
 * call (including the retry), a faulted call succeeds on its retry, so `resilient(faultyPort(...))`
 * makes forward progress. This lets the engine weather Discord's real failure modes against the
 * MockGuild, long before a real guild is touched.
 */
export function faultyPort<T extends object>(port: T, config: FaultConfig): T {
  let n = 0;
  return new Proxy(port, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);
      if (typeof orig !== 'function') return orig;
      const route = String(prop);
      if (config.only && !config.only.includes(route)) return orig;
      return (...args: unknown[]) => {
        n += 1;
        if (config.transientEvery && n % config.transientEvery === 0) {
          throw new DiscordTransientError(route, config.transientStatus ?? 503);
        }
        if (config.rateLimitEvery && n % config.rateLimitEvery === 0) {
          throw new DiscordRateLimitError(route, config.retryAfterMs ?? 50);
        }
        return (orig as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as T;
}
