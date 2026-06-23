/**
 * Transient-failure resilience for the Discord ports. Real Discord returns 429s (with Retry-After)
 * and the occasional 5xx; the live discord.js REST client already queues + backs off on 429, but the
 * engine should still weather rate limits and transient errors uniformly — and the MockGuild injects
 * the same failure modes so this path is exercised long before a real guild is touched.
 */

/** Thrown to signal a rate limit; the wrapper waits `retryAfterMs` then retries the same call. */
export class DiscordRateLimitError extends Error {
  constructor(
    public readonly route: string,
    public readonly retryAfterMs: number,
  ) {
    super(`rate limited on ${route}; retry after ${retryAfterMs}ms`);
    this.name = 'DiscordRateLimitError';
  }
}

/** Thrown for a transient server error (5xx / network blip); retried with exponential backoff. */
export class DiscordTransientError extends Error {
  constructor(
    public readonly route: string,
    public readonly status: number,
  ) {
    super(`transient ${status} on ${route}`);
    this.name = 'DiscordTransientError';
  }
}

export interface ResilienceOptions {
  /** Max retries per individual call before giving up (default 6). */
  maxRetries?: number;
  /** Cap on a single backoff wait, ms (default 5000). */
  maxBackoffMs?: number;
  /** Stream throttling notices to the live log. */
  onLog?: (msg: string) => void;
  /** Injected sleep — tests pass a no-op to stay fast. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Wrap any port object so every async method retries rate-limit + transient failures. A Proxy is used
 * so future port methods are covered automatically. Fatal errors (anything not a rate-limit/transient)
 * propagate unchanged — the engine still halts on lost-token / missing-Admin.
 */
export function resilient<T extends object>(port: T, opts: ResilienceOptions = {}): T {
  const maxRetries = opts.maxRetries ?? 6;
  const maxBackoff = opts.maxBackoffMs ?? 5000;
  const sleep = opts.sleep ?? defaultSleep;
  const log = opts.onLog ?? (() => {});

  return new Proxy(port, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);
      if (typeof orig !== 'function') return orig;
      const route = String(prop);
      return async (...args: unknown[]) => {
        let attempt = 0;
        for (;;) {
          try {
            return await (orig as (...a: unknown[]) => unknown).apply(target, args);
          } catch (err) {
            if (err instanceof DiscordRateLimitError && attempt < maxRetries) {
              log(`throttling… ${route} rate limited, retry in ${err.retryAfterMs}ms (attempt ${attempt + 1})`);
              await sleep(err.retryAfterMs);
              attempt += 1;
              continue;
            }
            if (err instanceof DiscordTransientError && attempt < maxRetries) {
              const backoff = Math.min(maxBackoff, 100 * 2 ** attempt);
              log(`transient ${err.status} on ${route}, retry in ${backoff}ms (attempt ${attempt + 1})`);
              await sleep(backoff);
              attempt += 1;
              continue;
            }
            throw err;
          }
        }
      };
    },
  }) as T;
}
