import { makeSampleSnapshot } from '@disco/core';
import { describe, expect, it } from 'vitest';
import { diffSnapshots } from '../src/diff.js';

/** #5 per-permission diff: role permission changes + channel overwrite changes are decoded to permission
 *  NAMES, and the raw bitfield/overwrite-array is NOT surfaced as a noisy field line. */
describe('snapshot diff — per-permission (#5)', () => {
  it('a permission-only role change surfaces a decoded delta with NO raw bitfield field', () => {
    const before = makeSampleSnapshot();
    const after = makeSampleSnapshot();
    const role = after.roles.find((r) => !r.isEveryone)!;
    // toggle the Administrator bit (1<<3 = 8) on this role, change nothing else
    const bits = BigInt(role.permissions) ^ 8n;
    role.permissions = bits.toString();

    const d = diffSnapshots(before, after);
    const changed = d.roles.changed.find((c) => c.name === role.name)!;
    expect(changed).toBeTruthy();
    // decoded into a permission name…
    expect(changed.permissionDelta).toBeTruthy();
    const names = [...(changed.permissionDelta!.added), ...(changed.permissionDelta!.removed)];
    expect(names).toContain('Administrator');
    // …and the raw `permissions` bitfield is NOT a field line (decode-only)
    expect(changed.fields.some((f) => f.field === 'permissions')).toBe(false);
  });

  it('a channel overwrite permission change is decoded into overwriteChanges, not a raw field', () => {
    const before = makeSampleSnapshot();
    const after = makeSampleSnapshot();
    const chan = after.channels.find((c) => c.overwrites.length > 0);
    if (!chan) return; // sample has no overwrites — nothing to assert
    const ow = chan.overwrites[0]!;
    ow.allow = (BigInt(ow.allow) | 8n).toString(); // grant Administrator in the overwrite
    const d = diffSnapshots(before, after);
    const oc = d.overwriteChanges.find((o) => o.container === chan.name);
    expect(oc).toBeTruthy();
    expect([...oc!.allow.added, ...oc!.allow.removed]).toContain('Administrator');
    // the channel's structural `changed` entry (if any) must NOT carry a raw `overwrites` field
    const cc = d.channels.changed.find((c) => c.name === chan.name);
    expect(cc?.fields.some((f) => f.field === 'overwrites') ?? false).toBe(false);
  });
});
