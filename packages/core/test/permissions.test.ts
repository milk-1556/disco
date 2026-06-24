import { describe, expect, it } from 'vitest';
import { decodePermissions, diffPermissions } from '../src/index.js';

describe('permission bitfield decode (§3 diff expansion)', () => {
  const VIEW = 1n << 10n;
  const SEND = 1n << 11n;
  const HISTORY = 1n << 16n;
  const MENTION = 1n << 17n;

  it('decodes a bitfield into human-readable permission names', () => {
    const names = decodePermissions(String(VIEW | SEND | HISTORY));
    expect(names).toContain('View Channel');
    expect(names).toContain('Send Messages');
    expect(names).toContain('Read History');
    expect(names).not.toContain('Mention Everyone');
  });

  it('handles an empty / malformed bitfield without throwing', () => {
    expect(decodePermissions('0')).toEqual([]);
    expect(decodePermissions('')).toEqual([]);
    expect(decodePermissions('not-a-number')).toEqual([]);
  });

  it('diffs two bitfields into granted vs revoked permissions', () => {
    const before = String(VIEW | SEND | MENTION);
    const after = String(VIEW | SEND | HISTORY); // gained Read History, lost Mention Everyone
    const d = diffPermissions(before, after);
    expect(d.added).toEqual(['Read History']);
    expect(d.removed).toEqual(['Mention Everyone']);
  });
});
