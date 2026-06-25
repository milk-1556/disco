import { makeSampleSnapshot, rebuildGuild } from '@disco/core';
import type { JobManifest } from '@disco/schema';
import { MockGuild } from '@disco/sdk';
import { describe, expect, it } from 'vitest';

/**
 * #2 BUILD RESUME ON FAILURE — proof, not assertion.
 *
 * The manifest checkpoint is supposed to make a crashed build resume from the failed step (N+1), adopt
 * objects an earlier attempt already created (never duplicate them), and finish — the single most
 * important reliability property before a real $40k client server is touched. This test forces a HARD
 * mid-build crash, then resumes against the SAME guild with the persisted manifest and proves all three.
 */

/** Wrap an ApplyPort so the (failAfter+1)th createChannel throws a FATAL (non-4xx) error — the engine
 *  treats this as a real crash (not a skippable item) and aborts with the manifest checkpointed. */
function crashOnNthChannel<T extends object>(port: T, failAfter: number): T {
  let n = 0;
  return new Proxy(port, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);
      if (prop === 'createChannel' && typeof orig === 'function') {
        return (...args: unknown[]) => {
          n += 1;
          if (n > failAfter) throw new Error('simulated hard crash mid-build');
          return (orig as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return orig;
    },
  }) as T;
}

describe('build resume on failure — manifest checkpoint (#2)', () => {
  it('a build that crashes mid-structure resumes from the failed step, completes, and never duplicates', async () => {
    const snap = makeSampleSnapshot();
    const guildId = '900000000000000000';
    const guild = new MockGuild(guildId, 'Resume Target'); // the SAME guild persists across both attempts

    // ── Attempt 1: crashes on the 2nd channel/category create ──
    let saved: JobManifest | undefined;
    await expect(
      rebuildGuild(crashOnNthChannel(guild, 1), snap, { jobId: 'resume_job', targetGuildId: guildId, onManifest: (m) => { saved = m; } }),
    ).rejects.toThrow(/crash/i);
    expect(saved, 'a checkpoint must be persisted before the crash').toBeDefined();

    const statusOf = (step: string) => saved!.steps.find((s) => s.step === step)?.status;
    expect(statusOf('roles'), 'roles complete before the channel crash').toBe('done');
    expect(statusOf('report'), 'the build did not finish').not.toBe('done');
    const rolesAfterCrash = (await guild.listRoles()).length; // roles already created in attempt 1

    // ── Attempt 2: resume against the SAME guild + the persisted manifest, with a clean (non-crashing) port ──
    const { manifest: final } = await rebuildGuild(guild, snap, { jobId: 'resume_job', targetGuildId: guildId, manifest: saved });

    // 1) it COMPLETES — every step done
    expect(final.steps.every((s) => s.status === 'done')).toBe(true);

    // 2) it RESUMED from N+1 — a step finished in attempt 1 (roles) was NOT re-entered (attempts stays 1),
    //    while the step the crash landed in WAS re-entered on resume (attempts >= 2). This is the core proof.
    expect(final.steps.find((s) => s.step === 'roles')!.attempts, 'a completed step is not re-run on resume').toBe(1);
    expect(final.steps.some((s) => s.attempts >= 2), 'the crashed step was re-entered on resume').toBe(true);

    // 3) NO duplication — every role/channel name appears exactly once in the target guild (adoption,
    //    not re-creation), and the role count is unchanged from attempt 1 (roles were never touched again).
    const roleNames = (await guild.listRoles()).map((r) => r.name);
    const chanNames = (await guild.listChannels()).map((c) => c.name);
    expect(new Set(roleNames).size, 'no duplicate roles').toBe(roleNames.length);
    expect(new Set(chanNames).size, 'no duplicate channels').toBe(chanNames.length);
    expect((await guild.listRoles()).length, 'roles not re-created on resume').toBe(rolesAfterCrash);
  });
});
