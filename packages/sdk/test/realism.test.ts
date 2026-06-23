import { captureSnapshot, makeSampleConfig, makeSampleSnapshot, rebrand, rebuildGuild, resilient } from '@disco/core';
import { describe, expect, it } from 'vitest';
import { faultyPort, MockGuild, mockGuildFromSnapshot } from '../src/index.js';

const noSleep = async () => {};

describe('engine weathers Discord-realistic failures (mock)', () => {
  it('builds idempotently despite 429s + transient 5xx across the whole build', async () => {
    const source = mockGuildFromSnapshot(makeSampleSnapshot());
    const snap = await captureSnapshot(source);
    const { snapshot: rebranded } = rebrand(snap, makeSampleConfig());

    // Inject Discord-real failure modes into the build target, then wrap with the resilient retry.
    const target = new MockGuild();
    const faulty = faultyPort(target, { rateLimitEvery: 3, transientEvery: 7, retryAfterMs: 1 });
    const logs: string[] = [];
    const port = resilient(faulty, { sleep: noSleep, onLog: (m) => logs.push(m) });

    const { report } = await rebuildGuild(port, rebranded, { jobId: 'fault', onLog: (m) => logs.push(m) });

    // It completed despite the faults…
    const built = await captureSnapshot(target);
    expect(built.guild.name).toBe('Nova Slots HQ');
    expect(built.roles.find((r) => r.name === 'Nova VIP')).toBeTruthy();
    expect(report.created.length).toBeGreaterThan(5);

    // …and the call-level retries did NOT duplicate anything (faulted calls don't run the side effect).
    expect(built.channels.filter((c) => c.name === 'rules')).toHaveLength(1);
    expect(built.roles.filter((r) => r.name === 'Nova VIP')).toHaveLength(1);
    expect(built.categories.filter((c) => c.name === 'Nova CHAT')).toHaveLength(1);

    // The throttle/transient notices were surfaced to the live log.
    expect(logs.some((l) => /throttling|transient/.test(l))).toBe(true);
  });

  it('mints realistic, monotonic, snowflake-shaped ids', async () => {
    const g = new MockGuild();
    const a = await g.createRole({ name: 'A', colors: { primary: 0, secondary: null, tertiary: null }, hoist: false, mentionable: false, permissions: '0' });
    const b = await g.createRole({ name: 'B', colors: { primary: 0, secondary: null, tertiary: null }, hoist: false, mentionable: false, permissions: '0' });
    expect(a).toMatch(/^\d{17,20}$/);
    expect(BigInt(b) > BigInt(a)).toBe(true); // sequence advances
    // The high bits encode a timestamp after the Discord epoch (2015), so it reads as a real snowflake.
    expect(BigInt(a) >> 22n).toBeGreaterThan(0n);
  });
});
