import { captureSnapshot, makeSampleConfig, makeSampleSnapshot, rebrand, rebuildGuild } from '@disco/core';
import type { JobManifest } from '@disco/schema';
import { describe, expect, it } from 'vitest';
import { MockGuild, mockGuildFromSnapshot } from '../src/index.js';

/**
 * Proves the load-bearing fix the design panel surfaced: rebuildGuild only writes manifest.entries
 * back at the very end, so without the per-object `onManifest` checkpoint a crash-resume would have
 * an empty manifest and re-create (duplicate) everything. These tests assert the checkpoint fires
 * per object and that resuming from it does NOT duplicate.
 */
describe('manifest checkpointing & crash-resume (§6)', () => {
  it('fires onManifest per object with committed newIds (not just once at the end)', async () => {
    const source = mockGuildFromSnapshot(makeSampleSnapshot());
    const snap = await captureSnapshot(source);
    const { snapshot: rebranded } = rebrand(snap, makeSampleConfig());

    const target = new MockGuild();
    const snapshots: JobManifest[] = [];
    await rebuildGuild(target, rebranded, { jobId: 'cp', onManifest: (m) => snapshots.push(structuredClone(m)) });

    // Many checkpoints, and the count of entries-with-id grows monotonically (per-object granularity).
    expect(snapshots.length).toBeGreaterThan(5);
    const withId = snapshots.map((m) => m.entries.filter((e) => e.newId).length);
    for (let i = 1; i < withId.length; i++) expect(withId[i]!).toBeGreaterThanOrEqual(withId[i - 1]!);
    // The final checkpoint has real role + channel ids.
    const last = snapshots[snapshots.length - 1]!;
    expect(last.entries.some((e) => e.kind === 'role' && e.newId)).toBe(true);
    expect(last.entries.some((e) => e.kind === 'channel' && e.newId)).toBe(true);
  });

  it('resumes from a mid-build crash without duplicating already-created objects', async () => {
    const source = mockGuildFromSnapshot(makeSampleSnapshot());
    const snap = await captureSnapshot(source);
    const { snapshot: rebranded } = rebrand(snap, makeSampleConfig());

    const target = new MockGuild();
    // Crash on the 4th channel-create (after roles, emoji, both categories, and 1 channel committed).
    let calls = 0;
    const realCreate = target.createChannel.bind(target);
    target.createChannel = async (input) => {
      calls += 1;
      if (calls === 4) throw new Error('simulated crash');
      return realCreate(input);
    };

    let persisted: JobManifest | undefined;
    await expect(
      rebuildGuild(target, rebranded, { jobId: 'rz', onManifest: (m) => (persisted = structuredClone(m)) }),
    ).rejects.toThrow('simulated crash');

    // The checkpoint captured progress: roles already have ids (proves it's not empty until the end).
    expect(persisted).toBeDefined();
    expect(persisted!.entries.filter((e) => e.kind === 'role' && e.newId).length).toBeGreaterThan(0);
    const rolesAtCrash = target.roles.size;

    // Resume on the same target with the persisted manifest; channels now succeed.
    target.createChannel = realCreate;
    const { report } = await rebuildGuild(target, rebranded, { jobId: 'rz', manifest: persisted });

    // Roles were NOT re-created on resume (their step was done in the persisted manifest).
    expect(target.roles.size).toBe(rolesAtCrash);
    expect(report.created.some((c) => c.startsWith('role:'))).toBe(false);

    // The build completed: channels exist, none duplicated.
    const built = await captureSnapshot(target);
    expect(built.channels.map((c) => c.name)).toEqual(expect.arrayContaining(['rules', 'welcome', 'general']));
    expect(built.roles.filter((r) => r.name === 'Nova VIP')).toHaveLength(1);
    expect(built.channels.filter((c) => c.name === 'rules')).toHaveLength(1);
  });
});
