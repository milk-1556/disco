import {
  captureSnapshot,
  dryRunReport,
  makeSampleConfig,
  makeSampleSnapshot,
  rebrand,
  rebuildGuild,
} from '@disco/core';
import { describe, expect, it } from 'vitest';
import { MockGuild, mockGuildFromSnapshot } from '../src/index.js';

/**
 * The §10 quality bar, end to end with zero Discord credentials:
 *   sample template → seed source MockGuild → capture → rebrand → dry-run → build into a fresh
 *   target MockGuild → report → re-capture target and assert the rebrand actually landed, plus
 *   idempotency (build twice → no duplicates).
 */
describe('snapshot → rebrand → dry-run → build → report (mock guild)', () => {
  it('captures a source guild into a portable snapshot', async () => {
    const source = mockGuildFromSnapshot(makeSampleSnapshot());
    const snap = await captureSnapshot(source);

    expect(snap.guild.name).toBe('Acme Slots HQ');
    expect(snap.channels.map((c) => c.name)).toContain('rules');
    expect(snap.roles.find((r) => r.name === 'Acme VIP')?.colors.primary).toBe(0x7c3aed);

    // classification ran during capture: info channels copy, chat does not
    const rules = snap.channels.find((c) => c.name === 'rules');
    expect(rules?.copyPolicy).toBe('system_content');
    expect(snap.channels.find((c) => c.name === 'general')?.copyPolicy).toBe('member_chat');

    // bot detection + brand tokens populated
    expect(snap.bots.find((b) => b.name === 'MEE6')?.vendorGuess).toBe('MEE6');
    expect(snap.brandTokens.some((t) => t.kind === 'name' && t.value === 'Acme')).toBe(true);

    // every cross-reference is a localRef, never a raw snowflake
    expect(rules?.categoryRef).toMatch(/^cat_/);
    expect(rules?.overwrites[0]?.targetRef).toBe('role_everyone');
  });

  it('dry-run produces a full report and writes nothing', async () => {
    const source = mockGuildFromSnapshot(makeSampleSnapshot());
    const snap = await captureSnapshot(source);
    const { snapshot: rebranded } = rebrand(snap, makeSampleConfig());

    const target = new MockGuild();
    const before = target.channels.size;
    const { report } = await rebuildGuild(target, rebranded, { dryRun: true, jobId: 'dry1' });

    expect(report.dryRun).toBe(true);
    expect(target.channels.size).toBe(before); // nothing written
    expect(report.created.some((c) => c.includes('rules'))).toBe(true);
    expect(report.manualSteps.some((s) => /MEE6/.test(s.title))).toBe(true);

    // The standalone dry-run report helper agrees on the manual steps.
    const standalone = dryRunReport(rebranded, 'dry1', '2026-06-22T12:00:00.000Z');
    expect(standalone.botChecklist).toContain('MEE6 (MEE6)');
  });

  it('builds the rebranded snapshot into a fresh guild, then proves the rebrand landed', async () => {
    const source = mockGuildFromSnapshot(makeSampleSnapshot());
    const snap = await captureSnapshot(source);
    const { snapshot: rebranded } = rebrand(snap, makeSampleConfig());

    const target = new MockGuild();
    const logs: string[] = [];
    const { report, manifest } = await rebuildGuild(target, rebranded, {
      jobId: 'build1',
      onLog: (m) => logs.push(m),
    });

    // Re-capture the freshly built guild and assert the new branding is present.
    const built = await captureSnapshot(target);
    expect(built.guild.name).toBe('Nova Slots HQ');
    expect(built.roles.find((r) => r.name === 'Nova VIP')?.colors.primary).toBe(0xe11d48);
    expect(built.channels.map((c) => c.name)).toEqual(expect.arrayContaining(['rules', 'welcome', 'general']));
    expect(built.categories.map((c) => c.name)).toContain('Nova CHAT');

    // Managed MEE6 role was NOT recreated (skipped, surfaced as a manual step instead).
    expect(built.roles.find((r) => r.name === 'MEE6')).toBeUndefined();
    expect(report.skipped.some((s) => s.reason === 'managed role')).toBe(true);

    // Structure pointers translated to new ids.
    expect(target.guild.systemChannelId).toBeTruthy();
    expect(target.guild.rulesChannelId).toBeTruthy();

    // Copied content landed via webhook in the rules channel, rebranded.
    const rulesId = [...target.channels.values()].find((c) => c.name === 'rules')!.id;
    const posted = target.posted.get(rulesId) ?? [];
    expect(posted.length).toBeGreaterThan(0);
    expect(JSON.stringify(posted)).toContain('Nova Slots Rules');
    expect(JSON.stringify(posted)).toContain('https://whop.com/nova-vip');

    // Member-target overwrite in #mods-only was skipped (no members yet).
    expect(report.skipped.some((s) => /member overwrite/.test(s.reason))).toBe(true);

    // Manifest recorded created ids; progress reached 100%.
    expect(Object.keys(manifest.idMap).length).toBeGreaterThan(5);
    expect(logs.some((l) => l.includes('roles'))).toBe(true);
  });

  it('is idempotent — building twice does not duplicate (§6)', async () => {
    const source = mockGuildFromSnapshot(makeSampleSnapshot());
    const snap = await captureSnapshot(source);
    const { snapshot: rebranded } = rebrand(snap, makeSampleConfig());

    const target = new MockGuild();
    const first = await rebuildGuild(target, rebranded, { jobId: 'b' });
    const channelsAfterFirst = target.channels.size;
    const rolesAfterFirst = target.roles.size;

    // Re-run with the SAME completed manifest (resume) → all steps already done, so it's a no-op:
    // nothing is created, nothing duplicated.
    const second = await rebuildGuild(target, rebranded, { jobId: 'b', manifest: first.manifest });
    expect(target.channels.size).toBe(channelsAfterFirst);
    expect(target.roles.size).toBe(rolesAfterFirst);
    expect(second.report.created.length).toBe(0);

    // The real idempotency proof: a FRESH manifest re-discovers the existing objects by name and
    // updates them in place — zero creates, still no duplicates.
    const third = await rebuildGuild(target, rebranded, { jobId: 'b2' });
    expect(target.channels.size).toBe(channelsAfterFirst);
    expect(target.roles.size).toBe(rolesAfterFirst);
    expect(third.report.created.length).toBe(0);
    expect(third.report.updated.length).toBeGreaterThan(0);
  });
});
