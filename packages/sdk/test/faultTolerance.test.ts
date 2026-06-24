import { makeProductionTraceSnapshot, rebuildGuild } from '@disco/core';
import { describe, expect, it } from 'vitest';
import { MockGuild } from '../src/index.js';

/**
 * The mock never fails — but a REAL, freshly-invited, usually-unboosted target guild legitimately
 * rejects individual writes (boost-locked stickers/banners, hierarchy-blocked perms, transient 5xx).
 * These tests inject those failures and assert the build degrades gracefully (records the item in the
 * report's `skipped` → it becomes a handover manual-step) instead of aborting a half-built server —
 * while still failing LOUD on a dead token or a systemically broken guild.
 */

/** Mimics discord.js's DiscordAPIError shape (it exposes `.status` and `.code`). */
class FakeDiscordError extends Error {
  constructor(
    public status: number,
    public code: number,
    message: string,
  ) {
    super(message);
  }
}

describe('live-build fault tolerance', () => {
  it('skips boost-locked items (stickers, banner) and still completes the build', async () => {
    const snap = makeProductionTraceSnapshot();
    const target = new MockGuild();

    // Tier-0 guild: no sticker slots, no BANNER feature. Everything else succeeds.
    target.createSticker = async () => {
      throw new FakeDiscordError(400, 30018, 'Maximum number of stickers reached (0)');
    };
    const realModify = MockGuild.prototype.modifyGuild;
    target.modifyGuild = async (patch) => {
      if (patch.bannerKey) throw new FakeDiscordError(400, 0, 'This server needs more boosts to set a banner (BANNER)');
      return realModify.call(target, patch);
    };

    const { report } = await rebuildGuild(target, snap, { jobId: 'ft-skip' });

    // The build did NOT abort — the rest of the server was still created.
    expect(report.created.some((c) => c.startsWith('channel:'))).toBe(true);
    expect(report.created.some((c) => c.startsWith('role:'))).toBe(true);
    // The rejected items are recorded with an operator-readable reason (→ handover manual steps).
    expect(report.skipped.some((s) => /sticker/i.test(s.ref) && /slot/i.test(s.reason))).toBe(true);
    expect(report.skipped.some((s) => /banner/i.test(s.ref))).toBe(true);
    // ...and the build is still considered a success that produced a usable server.
    expect(target.channels.size).toBeGreaterThan(0);
  });

  it('aborts loudly on an invalid/revoked token (401) rather than emitting a hollow server', async () => {
    const snap = makeProductionTraceSnapshot();
    const target = new MockGuild();
    target.createRole = async () => {
      throw new FakeDiscordError(401, 0, 'invalid bot token');
    };
    await expect(rebuildGuild(target, snap, { jobId: 'ft-401' })).rejects.toThrow(/token is invalid|revoked|aborted/i);
  });

  it('aborts after many consecutive failures (the bot has no real access)', async () => {
    const snap = makeProductionTraceSnapshot();
    const target = new MockGuild();
    const denied = async () => {
      throw new FakeDiscordError(403, 50013, 'Missing Permissions');
    };
    target.createRole = denied as typeof target.createRole;
    target.createEmoji = denied as typeof target.createEmoji;
    target.createSticker = denied as typeof target.createSticker;
    target.createChannel = denied as typeof target.createChannel;
    await expect(rebuildGuild(target, snap, { jobId: 'ft-403' })).rejects.toThrow(/consecutive|aborted/i);
  });
});
