import { describe, expect, it } from 'vitest';
import { dryRunReport, freshSteps, planRebuild, progressFromManifest, stepCounts } from '../src/index.js';
import { makeSampleSnapshot } from './fixtures.js';

describe('rebuild plan & dry-run (§6)', () => {
  it('emits the dependency-ordered steps', () => {
    const steps = freshSteps().map((s) => s.step);
    expect(steps).toEqual([
      'guild_settings', 'roles', 'expressions', 'categories', 'channels',
      'overwrites', 'automod', 'pointers', 'content', 'bot_detection', 'report',
    ]);
  });

  it('counts what each step will touch (managed objects excluded)', () => {
    const counts = stepCounts(makeSampleSnapshot());
    // 4 roles total, minus @everyone and the managed MEE6 role → 2 creatable
    expect(counts.roles).toBe(2);
    expect(counts.channels).toBe(7);
    expect(counts.categories).toBe(2);
    expect(counts.automod).toBe(1);
  });

  it('assembles manual steps for everything not cloneable', () => {
    const plan = planRebuild(makeSampleSnapshot());
    const titles = plan.manualSteps.map((s) => s.title).join('\n');
    expect(titles).toMatch(/Re-invite & configure MEE6/);
    expect(titles).toMatch(/managed by an integration/); // managed MEE6 role
    expect(titles).toMatch(/Reconnect interactive panel/); // role-select panel
    expect(titles).toMatch(/Member roles, boosts/); // always-on member-data note
    expect(plan.manualSteps.some((s) => s.category === 'bot')).toBe(true);
    // member overwrite in #mods-only → warning
    expect(plan.warnings.join('\n')).toMatch(/member-specific permission overwrite/);
    // boost tier 2 → warning
    expect(plan.warnings.join('\n')).toMatch(/boost tier 2/);
  });

  it('produces a dry-run report that writes nothing to Discord', () => {
    const report = dryRunReport(makeSampleSnapshot(), 'job_1', '2026-06-22T12:00:00.000Z');
    expect(report.dryRun).toBe(true);
    expect(report.targetGuildId).toBeNull();
    expect(report.created).toContain('#rules');
    expect(report.created).toContain('role: Acme VIP');
    expect(report.created).not.toContain('role: MEE6'); // managed → skipped
    expect(report.skipped.some((s) => s.reason === 'managed role')).toBe(true);
    expect(report.botChecklist).toContain('MEE6 (MEE6)');
  });

  it('computes progress from manifest step completion', () => {
    const steps = freshSteps();
    steps[0]!.status = 'done';
    steps[1]!.status = 'done';
    const pct = progressFromManifest({
      jobId: 'j', targetGuildId: null, dryRun: false, steps, entries: [], idMap: {},
    });
    expect(pct).toBeCloseTo(2 / 11);
  });
});
