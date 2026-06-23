import { describe, expect, it } from 'vitest';
import { DiscordRateLimitError, DiscordTransientError, resilient } from '../src/index.js';

const noSleep = async () => {};

describe('resilient port wrapper', () => {
  it('retries a rate-limited call until it succeeds', async () => {
    let calls = 0;
    const port = {
      op: async () => {
        calls += 1;
        if (calls < 3) throw new DiscordRateLimitError('op', 1);
        return 'ok';
      },
    };
    expect(await resilient(port, { sleep: noSleep }).op()).toBe('ok');
    expect(calls).toBe(3);
  });

  it('retries a transient 5xx with backoff', async () => {
    let calls = 0;
    const port = {
      op: async () => {
        calls += 1;
        if (calls < 2) throw new DiscordTransientError('op', 503);
        return 42;
      },
    };
    expect(await resilient(port, { sleep: noSleep }).op()).toBe(42);
    expect(calls).toBe(2);
  });

  it('gives up after maxRetries', async () => {
    const port = { op: async () => { throw new DiscordRateLimitError('op', 1); } };
    await expect(resilient(port, { sleep: noSleep, maxRetries: 2 }).op()).rejects.toBeInstanceOf(DiscordRateLimitError);
  });

  it('propagates a fatal (non-transient) error immediately', async () => {
    let calls = 0;
    const port = {
      op: async () => {
        calls += 1;
        throw new Error('missing Administrator');
      },
    };
    await expect(resilient(port, { sleep: noSleep }).op()).rejects.toThrow('missing Administrator');
    expect(calls).toBe(1); // no retries on a fatal error
  });

  it('streams throttle notices to onLog', async () => {
    const logs: string[] = [];
    let calls = 0;
    const port = {
      op: async () => {
        calls += 1;
        if (calls < 2) throw new DiscordRateLimitError('createRole', 5);
        return 'ok';
      },
    };
    await resilient(port, { sleep: noSleep, onLog: (m) => logs.push(m) }).op();
    expect(logs.some((l) => /throttling/.test(l))).toBe(true);
  });
});
