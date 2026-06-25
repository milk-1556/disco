import type {
  JobManifest,
  ManualStep,
  RebuildReport,
  RebuildStep,
  Snapshot,
  StepState,
} from '@disco/schema';
import { REBUILD_STEP_ORDER } from '@disco/schema';
import { generateBotSetup } from '../botSetup.js';

export interface RebuildPlan {
  steps: StepState[];
  /** What each step will touch — drives the progress bar denominator. */
  counts: Record<string, number>;
  manualSteps: ManualStep[];
  warnings: string[];
}

/** A fresh, dependency-ordered step list with all steps pending (§6). */
export function freshSteps(): StepState[] {
  return REBUILD_STEP_ORDER.map((step: RebuildStep) => ({
    step,
    status: 'pending' as const,
    startedAt: null,
    finishedAt: null,
    attempts: 0,
  }));
}

/** Count how many objects each rebuild step will process, for progress + report. */
export function stepCounts(snap: Snapshot): Record<string, number> {
  const overwrites = snap.channels.reduce((n, c) => n + c.overwrites.length, 0) +
    snap.categories.reduce((n, c) => n + c.overwrites.length, 0);
  const contentMsgs = snap.content
    .filter((c) => snap.channels.find((ch) => ch.localRef === c.channelRef)?.copyContent)
    .reduce((n, c) => n + c.messages.length, 0);
  return {
    guild_settings: 1,
    roles: snap.roles.filter((r) => !r.isEveryone && !r.managed).length,
    expressions: snap.emojis.filter((e) => !e.managed).length + snap.stickers.length,
    categories: snap.categories.length,
    channels: snap.channels.length,
    overwrites,
    automod: snap.automod.length,
    pointers: 1,
    content: contentMsgs,
    bot_detection: snap.bots.length,
    report: 1,
  };
}

/**
 * Assemble the guided Manual Steps for everything that is NOT cloneable (§1, §5, §6). Every
 * impossible item gets a one-line reason — never silently skipped, never faked.
 */
export function manualSteps(snap: Snapshot): { steps: ManualStep[]; warnings: string[] } {
  const steps: ManualStep[] = [];
  const warnings: string[] = [];

  // Third-party bots — config lives on the vendor's servers.
  for (const bot of snap.bots) {
    steps.push({
      title: `Re-invite & configure ${bot.name}`,
      reason:
        bot.vendorGuess
          ? `${bot.vendorGuess} settings live on the vendor's servers — no API can copy them.`
          : `This bot's settings live on its vendor's servers — no API can copy them.`,
      url: bot.inviteUrl,
      botRef: bot.localRef,
      category: 'bot',
    });
  }

  // Managed roles can't be recreated as normal roles.
  for (const r of snap.roles.filter((r) => r.managed)) {
    steps.push({
      title: `Role "${r.name}" is managed by an integration`,
      reason: 'Managed roles are recreated automatically when the owning bot/integration is added.',
      url: null,
      botRef: null,
      category: 'bot',
    });
  }

  // Interactive panels (reaction-role/button/ticket) copy visually but won't function.
  for (const cc of snap.content.filter((c) => c.hasInteractiveComponents)) {
    const ch = snap.channels.find((c) => c.localRef === cc.channelRef);
    steps.push({
      title: `Reconnect interactive panel in #${ch?.name ?? cc.channelRef}`,
      reason:
        'Reaction-role / button / ticket panels are copied visually but need the owning bot reconfigured to work.',
      url: null,
      botRef: null,
      category: 'interactive',
    });
  }

  // Member-target overwrites cannot be applied (no members yet).
  const memberOverwrites =
    snap.channels.reduce((n, c) => n + c.overwrites.filter((o) => o.targetType === 'member').length, 0) +
    snap.categories.reduce((n, c) => n + c.overwrites.filter((o) => o.targetType === 'member').length, 0);
  if (memberOverwrites > 0) {
    warnings.push(
      `${memberOverwrites} member-specific permission overwrite(s) will be skipped — the target has no members yet.`,
    );
  }

  // Boost-locked perks.
  if (snap.guild.premiumTier > 0) {
    warnings.push(
      `Source was boost tier ${snap.guild.premiumTier}. Boost-locked perks (extra emoji slots, banner, vanity URL, better audio) apply only once the target reaches that tier.`,
    );
  }

  // Always-true reminders for member data & feature gates.
  steps.push({
    title: 'Member roles, boosts, and the member list are not transferred',
    reason: 'There are no members in the fresh guild yet; member→role assignments happen after people join.',
    url: null,
    botRef: null,
    category: 'member_data',
  });
  if (snap.guild.welcomeScreen?.enabled || snap.guild.assets.discoverySplash) {
    steps.push({
      title: 'Discovery / Monetization features require Discord review',
      reason: 'These community features are gated behind Discord approval and cannot be enabled via the API.',
      url: 'https://support.discord.com/hc/en-us/articles/360047132851',
      botRef: null,
      category: 'feature_gated',
    });
  }

  return { steps, warnings };
}

/** Produce the full Discord-free rebuild plan for a rebranded snapshot. */
export function planRebuild(snap: Snapshot): RebuildPlan {
  const { steps: manual, warnings } = manualSteps(snap);
  return {
    steps: freshSteps(),
    counts: stepCounts(snap),
    manualSteps: manual,
    warnings,
  };
}

/**
 * Produce a dry-run RebuildReport — the full report + manual steps WITHOUT writing to Discord, so
 * the operator can verify a client build before committing (§6 dry-run mode).
 */
export function dryRunReport(snap: Snapshot, jobId: string, generatedAt: string): RebuildReport {
  const plan = planRebuild(snap);
  const created: string[] = [
    ...snap.roles.filter((r) => !r.isEveryone && !r.managed).map((r) => `role: ${r.name}`),
    ...snap.categories.map((c) => `category: ${c.name}`),
    ...snap.channels.map((c) => `#${c.name}`),
    ...snap.emojis.filter((e) => !e.managed).map((e) => `emoji: ${e.name}`),
    ...snap.stickers.map((s) => `sticker: ${s.name}`),
    ...snap.automod.map((a) => `automod: ${a.name}`),
  ];
  const skipped = [
    ...snap.roles.filter((r) => r.managed).map((r) => ({ ref: `role: ${r.name}`, reason: 'managed role' })),
    ...snap.emojis.filter((e) => e.managed).map((e) => ({ ref: `emoji: ${e.name}`, reason: 'managed emoji' })),
  ];
  return {
    jobId,
    dryRun: true,
    targetGuildId: null,
    counts: plan.counts,
    created,
    updated: [],
    skipped,
    manualSteps: plan.manualSteps,
    botChecklist: snap.bots.map((b) => `${b.name}${b.vendorGuess ? ` (${b.vendorGuess})` : ''}`),
    botSetup: generateBotSetup(snap.bots),
    warnings: plan.warnings,
    generatedAt,
  };
}

/** Recompute build progress (0..1) from a manifest's step completion. */
export function progressFromManifest(manifest: JobManifest): number {
  if (!manifest.steps.length) return 0;
  const done = manifest.steps.filter((s) => s.status === 'done').length;
  return done / manifest.steps.length;
}
