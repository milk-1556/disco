import { describe, expect, it } from 'vitest';
import { auditAuthority, auditBuildLimits, combineRolePermissions, makeSampleSnapshot, REQUIRED_PERMISSIONS } from '../src/index.js';

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

describe('build feasibility audit (§ pre-flight build limits)', () => {
  it('the sample snapshot fits within Discord limits (boost-tier perk warning aside)', () => {
    const a = auditBuildLimits(makeSampleSnapshot());
    expect(a.ok).toBe(true); // no hard blocks
    expect(a.findings.some((f) => f.name === 'Boost perks')).toBe(true); // tier 2 → boost warning
  });

  it('blocks when roles exceed the 250-role limit', () => {
    const snap = makeSampleSnapshot();
    snap.roles = Array.from({ length: 260 }, (_, i) => ({ ...snap.roles[0]!, localRef: `r${i}`, name: `r${i}` }));
    const a = auditBuildLimits(snap);
    expect(a.ok).toBe(false);
    expect(a.findings.find((f) => f.name === 'Roles')?.severity).toBe('block');
  });

  it('warns when AutoMod keyword rules exceed 6 per type', () => {
    const snap = makeSampleSnapshot();
    snap.automod = Array.from({ length: 8 }, (_, i) => ({ ...snap.automod[0]!, localRef: `am${i}`, triggerType: 1 as const }));
    const a = auditBuildLimits(snap);
    expect(a.findings.some((f) => f.name === 'AutoMod')).toBe(true);
  });

  // ── target boost-tier cross-check: what the destination guild can't take yet ──
  const withBoostLockedAssets = () => {
    const snap = makeSampleSnapshot();
    snap.guild.assets = { ...snap.guild.assets, banner: 'assets/banner.png', splash: 'assets/splash.png' };
    const last = snap.roles[snap.roles.length - 1]!;
    last.icon = 'assets/roleicon.png';
    last.colors = { ...last.colors, secondary: 0x123456, tertiary: null };
    return snap;
  };

  it('flags every boost-locked item when building into a tier-0 (fresh) guild', () => {
    const a = auditBuildLimits(withBoostLockedAssets(), 0);
    const names = a.findings.map((f) => f.name);
    expect(names).toContain('Server banner');
    expect(names).toContain('Invite splash');
    expect(names).toContain('Role icons');
    expect(names).toContain('Role colors');
    expect(a.ok).toBe(true); // boost-locked items are warnings, not hard blocks — operator may build anyway
  });

  it('clears the boost-locked items when the target is already tier 2', () => {
    const a = auditBuildLimits(withBoostLockedAssets(), 2);
    const names = a.findings.map((f) => f.name);
    expect(names).not.toContain('Server banner'); // tier 2 unlocks banner + role icons + gradient colors
    expect(names).not.toContain('Invite splash');
    expect(names).not.toContain('Role icons');
    expect(names).not.toContain('Role colors');
    expect(names).not.toContain('Boost perks'); // source tier 2 === target tier 2
  });

  it('flags a banner against an unboosted guild with the tier it needs', () => {
    const snap = makeSampleSnapshot();
    snap.guild.assets = { ...snap.guild.assets, banner: 'assets/banner.png' };
    const banner = auditBuildLimits(snap, 0).findings.find((f) => f.name === 'Server banner');
    expect(banner).toBeDefined();
    expect(banner!.severity).toBe('warn');
    expect(banner!.detail).toMatch(/tier 2/); // names the upgrade it needs
  });
});
