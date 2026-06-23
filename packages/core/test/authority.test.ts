import { describe, expect, it } from 'vitest';
import { auditAuthority, combineRolePermissions, REQUIRED_PERMISSIONS } from '../src/index.js';

describe('pre-flight authority audit (§ before live)', () => {
  it('passes when the bot has Administrator', () => {
    const a = auditAuthority((1n << 3n).toString());
    expect(a.ok).toBe(true);
    expect(a.hasAdmin).toBe(true);
    expect(a.missing).toHaveLength(0);
  });

  it('reports exactly which granular permissions are missing', () => {
    const perms = ((1n << 10n) | (1n << 4n)).toString(); // only View Channels + Manage Channels
    const a = auditAuthority(perms);
    expect(a.hasAdmin).toBe(false);
    expect(a.ok).toBe(false);
    const names = a.missing.map((m) => m.name);
    expect(names).toContain('Manage Roles');
    expect(names).toContain('Manage Webhooks');
    expect(names).not.toContain('View Channels');
    expect(names).not.toContain('Manage Channels');
  });

  it('passes when every required granular bit is present (no admin)', () => {
    const all = REQUIRED_PERMISSIONS.reduce((acc, p) => acc | p.bit, 0n).toString();
    const a = auditAuthority(all);
    expect(a.hasAdmin).toBe(false);
    expect(a.ok).toBe(true);
    expect(a.missing).toHaveLength(0);
  });

  it('combines role permission bitfields (OR)', () => {
    expect(combineRolePermissions(['1', '2', '4'])).toBe('7');
    expect(combineRolePermissions(['8', 'garbage', '0'])).toBe('8');
  });
});
