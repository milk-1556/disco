import { Snapshot } from '@disco/schema';
import { describe, expect, it } from 'vitest';
import { auditBuildLimits, classifyChannels, extractBrandTokens, makeProductionTraceSnapshot } from '../src/index.js';

describe('production-trace fixture (higher-fidelity template)', () => {
  it('is a valid, internally-consistent Snapshot', () => {
    const snap = makeProductionTraceSnapshot();
    expect(() => Snapshot.parse(snap)).not.toThrow();
    expect(snap.channels.length).toBeGreaterThan(15);
    expect(snap.roles.length).toBeGreaterThan(6);
    expect(snap.bots.length).toBeGreaterThanOrEqual(2);

    // every cross-reference resolves to a real localRef
    const roleRefs = new Set(snap.roles.map((r) => r.localRef));
    const catRefs = new Set(snap.categories.map((c) => c.localRef));
    const chanRefs = new Set(snap.channels.map((c) => c.localRef));
    for (const ch of snap.channels) if (ch.categoryRef) expect(catRefs.has(ch.categoryRef)).toBe(true);
    for (const ch of snap.channels)
      for (const o of ch.overwrites) if (o.targetType === 'role') expect(roleRefs.has(o.targetRef)).toBe(true);
    for (const cc of snap.content) expect(chanRefs.has(cc.channelRef)).toBe(true);
  });

  it('classifies + extracts tokens + audits limits without error', () => {
    const snap = makeProductionTraceSnapshot();
    expect(classifyChannels(snap).channels.some((c) => c.copyPolicy === 'system_content')).toBe(true);
    expect(extractBrandTokens(snap).some((t) => /stakehaus/i.test(t.value))).toBe(true);
    expect(auditBuildLimits(snap).ok).toBe(true); // a real-but-reasonable server fits Discord limits
  });
});
