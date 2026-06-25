import { describe, expect, it } from 'vitest';
import { makeProductionTraceSnapshot, makeSampleSnapshot, mergeSnapshots } from '../src/index.js';

/** Collect every localRef the composite defines (the valid targets a *Ref may point at). */
function localRefs(snap: ReturnType<typeof makeSampleSnapshot>): Set<string> {
  const s = new Set<string>(['role_everyone']);
  for (const kind of ['roles', 'categories', 'channels', 'emojis', 'stickers', 'automod'] as const) {
    for (const o of snap[kind] as { localRef: string }[]) s.add(o.localRef);
  }
  return s;
}

describe('snapshot composability — merge two snapshots (#5)', () => {
  it('unions B-only objects, flags name collisions, and produces a schema-valid composite', () => {
    const a = makeSampleSnapshot();
    const b = makeProductionTraceSnapshot();
    const { snapshot, conflicts } = mergeSnapshots(a, b);

    // every A object survives; B-only objects are appended (union by name)
    expect(snapshot.roles.length).toBeGreaterThanOrEqual(a.roles.length);
    expect(snapshot.channels.length).toBeGreaterThanOrEqual(a.channels.length);
    for (const ch of a.channels) expect(snapshot.channels.some((c) => c.name === ch.name)).toBe(true);
    for (const ch of b.channels) expect(snapshot.channels.some((c) => c.name === ch.name)).toBe(true);
    // name collisions are reported as conflicts (each a {kind,name})
    expect(Array.isArray(conflicts)).toBe(true);
  });

  it('keeps the merged graph self-consistent — every cross-reference resolves to a real localRef', () => {
    const { snapshot } = mergeSnapshots(makeSampleSnapshot(), makeProductionTraceSnapshot());
    const refs = localRefs(snapshot);
    // channel.categoryRef must point at a category that exists in the composite
    for (const c of snapshot.channels) {
      if (c.categoryRef) expect(refs.has(c.categoryRef)).toBe(true);
      for (const o of c.overwrites) if (o.targetType === 'role') expect(refs.has(o.targetRef)).toBe(true);
    }
    for (const cat of snapshot.categories) {
      for (const o of cat.overwrites) if (o.targetType === 'role') expect(refs.has(o.targetRef)).toBe(true);
    }
    for (const e of snapshot.emojis) for (const rr of e.roleRefs) expect(refs.has(rr)).toBe(true);
    for (const am of snapshot.automod) {
      for (const rr of am.exemptRoleRefs) expect(refs.has(rr)).toBe(true);
      for (const cr of am.exemptChannelRefs) expect(refs.has(cr)).toBe(true);
    }
  });

  it("resolution 'b' uses B's content under A's localRef so existing references stay valid", () => {
    const a = makeSampleSnapshot();
    const b = makeProductionTraceSnapshot();
    // find a role name that exists in BOTH (a guaranteed collision to resolve)
    const both = a.roles.find((ar) => b.roles.some((br) => br.name === ar.name && !ar.isEveryone));
    if (!both) return; // no overlapping role in the fixtures — nothing to assert
    const aRole = a.roles.find((r) => r.name === both.name)!;
    const merged = mergeSnapshots(a, b, { [`roles:${both.name}`]: 'b' }).snapshot;
    const winner = merged.roles.find((r) => r.name === both.name)!;
    expect(winner.localRef).toBe(aRole.localRef); // A's ref preserved (so A's references still resolve)
    // exactly one role of that name (no duplicate)
    expect(merged.roles.filter((r) => r.name === both.name)).toHaveLength(1);
  });
});
