import { describe, expect, it } from 'vitest';
import { buildIdMap, commitEntry, reconcile, type DesiredObject } from '../src/index.js';

const desired: DesiredObject[] = [
  { localRef: 'role_vip', kind: 'role', name: 'VIP' },
  { localRef: 'role_mod', kind: 'role', name: 'Mod' },
  { localRef: 'chan_rules', kind: 'channel', name: 'rules' },
];

describe('manifest reconciliation — idempotency (§6)', () => {
  it('creates everything on a fresh build', () => {
    const r = reconcile(desired, { entries: [] });
    expect(r.items.every((i) => i.action === 'create')).toBe(true);
  });

  it('building twice updates in place — no duplicates', () => {
    // First pass: create, then simulate performing each create by assigning ids.
    const first = reconcile(desired, { entries: [] });
    let entries = first.entries;
    entries = commitEntry(entries, 'role_vip', '900000000000000001', 'created');
    entries = commitEntry(entries, 'role_mod', '900000000000000002', 'created');
    entries = commitEntry(entries, 'chan_rules', '900000000000000003', 'created');

    // Second pass with the populated manifest → all updates, same ids, zero creates.
    const second = reconcile(desired, { entries });
    expect(second.items.every((i) => i.action === 'update')).toBe(true);
    expect(second.items.map((i) => i.newId)).toEqual([
      '900000000000000001',
      '900000000000000002',
      '900000000000000003',
    ]);
  });

  it('adopts an object created by a crashed run but not recorded (match by kind+name)', () => {
    // No manifest entry, but the target already has a "rules" channel from a crash.
    const existing = new Map([['channel:rules', '900000000000000099']]);
    const r = reconcile(desired, { entries: [] }, existing);
    const rules = r.items.find((i) => i.localRef === 'chan_rules');
    expect(rules?.action).toBe('update');
    expect(rules?.newId).toBe('900000000000000099');
    expect(rules?.note).toMatch(/adopted/);
    // the others still create
    expect(r.items.filter((i) => i.action === 'create')).toHaveLength(2);
  });

  it('builds a localRef→id map from committed entries', () => {
    const first = reconcile(desired, { entries: [] });
    const entries = commitEntry(first.entries, 'role_vip', '900000000000000001', 'created');
    expect(buildIdMap(entries)).toEqual({ role_vip: '900000000000000001' });
  });
});
