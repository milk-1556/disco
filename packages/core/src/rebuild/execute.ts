import type {
  JobManifest,
  ManifestEntry,
  RebuildReport,
  RebuildStep,
  Snapshot,
} from '@disco/schema';
import { REBUILD_STEP_ORDER } from '@disco/schema';
import { generateBotSetup } from '../botSetup.js';
import type { ApplyPort, RawMessage, RawOverwrite } from '../ports.js';
import { mentionsToIds } from '../snapshot/refs.js';
import { buildIdMap, commitEntry, reconcile, type DesiredObject } from './manifest.js';
import { freshSteps, manualSteps, stepCounts } from './plan.js';

export interface RebuildOptions {
  dryRun?: boolean;
  /** Resume from a prior manifest (idempotent reconciliation). */
  manifest?: JobManifest;
  jobId?: string;
  targetGuildId?: string | null;
  generatedAt?: string;
  /** Identity to post copied content as. */
  contentIdentity?: 'preserve' | 'server';
  serverIdentityName?: string;
  onLog?: (msg: string) => void;
  onProgress?: (pct: number, step: RebuildStep) => void;
  /**
   * Checkpoint callback fired after every object is committed and on each step completion, with a
   * snapshot of the live manifest (entries + idMap). CRITICAL for crash-resume: the engine only
   * writes `manifest.entries` back at the very end, so a persister relying on the returned manifest
   * would lose all localRef→newId mappings mid-build and a retry would re-create (duplicate)
   * everything. Persist this snapshot to survive a crash and resume idempotently.
   */
  onManifest?: (m: JobManifest) => void;
}

export interface RebuildOutcome {
  manifest: JobManifest;
  report: RebuildReport;
}

const TYPE_OF_KIND: Record<Snapshot['channels'][number]['kind'], number> = {
  text: 0,
  voice: 2,
  category: 4,
  announcement: 5,
  stage: 13,
  forum: 15,
  media: 16,
};

/**
 * Rebuild a (rebranded) snapshot into a target guild in dependency-correct order (§6): guild
 * settings → roles → expressions → categories → channels → overwrites → automod → pointers →
 * content → bot detection → report. Idempotent and resumable: every created object is recorded in
 * the manifest before proceeding, so a crash/resume reconciles instead of duplicating. `dryRun`
 * simulates the entire build and produces the full report WITHOUT writing to Discord.
 */
export async function rebuildGuild(
  port: ApplyPort,
  snap: Snapshot,
  opts: RebuildOptions = {},
): Promise<RebuildOutcome> {
  const dry = opts.dryRun ?? false;
  const log = opts.onLog ?? (() => {});
  const manifest: JobManifest = opts.manifest ?? {
    jobId: opts.jobId ?? 'job',
    targetGuildId: opts.targetGuildId ?? null,
    dryRun: dry,
    steps: freshSteps(),
    entries: [],
    idMap: {},
  };
  let entries: ManifestEntry[] = manifest.entries;
  const created: string[] = [];
  const updated: string[] = [];
  const skipped: Array<{ ref: string; reason: string }> = [];

  const idMap = () => ({ ...buildIdMap(entries), ...manifest.idMap });
  /** Emit a live snapshot of the manifest (with the up-to-date local `entries`) for durable resume. */
  const checkpoint = () => opts.onManifest?.({ ...manifest, entries, idMap: idMap() });
  const markStep = (step: RebuildStep, status: 'running' | 'done') => {
    const s = manifest.steps.find((x) => x.step === step);
    if (s) {
      s.status = status === 'running' ? 'running' : 'done';
      if (status === 'running') s.startedAt = opts.generatedAt ?? new Date().toISOString();
      else s.finishedAt = opts.generatedAt ?? new Date().toISOString();
    }
    const done = manifest.steps.filter((x) => x.status === 'done').length;
    opts.onProgress?.(done / manifest.steps.length, step);
    if (status === 'done') checkpoint();
  };
  const isDone = (step: RebuildStep) => manifest.steps.find((x) => x.step === step)?.status === 'done';

  /** Perform a reconciled create/update over a set of desired objects, committing ids to the manifest. */
  const runReconciled = async (
    kind: ManifestEntry['kind'],
    desired: DesiredObject[],
    create: (d: DesiredObject) => Promise<string>,
  ) => {
    const existing = dry ? [] : await port.listExisting(kind === 'webhook' ? 'channel' : kind).catch(() => []);
    const existingByKey = new Map(existing.map((e) => [`${kind}:${e.name.toLowerCase()}`, e.id]));
    const { items, entries: planned } = reconcile(desired, { entries }, existingByKey);
    // merge planned entries into the running entry list
    const byRef = new Map(entries.map((e) => [e.localRef, e]));
    for (const p of planned) byRef.set(p.localRef, p);
    entries = [...byRef.values()];

    for (const item of items) {
      if (item.action === 'update' && item.newId) {
        updated.push(`${kind}: ${item.name}`);
        entries = commitEntry(entries, item.localRef, item.newId, 'updated');
        checkpoint();
        continue;
      }
      if (dry) {
        created.push(`${kind}: ${item.name}`);
        entries = commitEntry(entries, item.localRef, `dry_${item.localRef}`, 'created');
        continue;
      }
      const newId = await create(item);
      created.push(`${kind}: ${item.name}`);
      entries = commitEntry(entries, item.localRef, newId, 'created');
      checkpoint(); // persist the new localRef→newId BEFORE the next create, so a crash resumes here
    }
  };

  const generatedAt = opts.generatedAt ?? new Date().toISOString();

  for (const step of REBUILD_STEP_ORDER) {
    if (isDone(step)) continue;
    markStep(step, 'running');
    log(`▶ ${step}`);

    switch (step) {
      case 'guild_settings': {
        if (!dry) {
          await port.modifyGuild({
            name: snap.guild.name,
            verificationLevel: snap.guild.verificationLevel,
            defaultMessageNotifications: snap.guild.defaultMessageNotifications,
            explicitContentFilter: snap.guild.explicitContentFilter,
            afkTimeout: snap.guild.afkTimeout,
            systemChannelFlags: snap.guild.systemChannelFlags,
            preferredLocale: snap.guild.preferredLocale,
            iconKey: snap.guild.assets.icon,
            bannerKey: snap.guild.assets.banner,
            splashKey: snap.guild.assets.splash,
          });
        }
        break;
      }

      case 'roles': {
        const everyoneId = dry ? 'dry_role_everyone' : await port.getEveryoneRoleId();
        manifest.idMap['role_everyone'] = everyoneId;
        const everyone = snap.roles.find((r) => r.isEveryone);
        if (everyone && !dry) await port.editEveryone(everyone.permissions);
        const buildable = snap.roles.filter((r) => !r.isEveryone && !r.managed);
        for (const r of snap.roles.filter((x) => x.managed)) skipped.push({ ref: `role: ${r.name}`, reason: 'managed role' });
        await runReconciled('role', buildable.map((r) => ({ localRef: r.localRef, kind: 'role', name: r.name })), async (d) => {
          const r = buildable.find((x) => x.localRef === d.localRef)!;
          return port.createRole({
            name: r.name,
            colors: r.colors,
            hoist: r.hoist,
            mentionable: r.mentionable,
            permissions: r.permissions,
            iconKey: r.icon ?? null,
            unicodeEmoji: r.unicodeEmoji ?? null,
          });
        });
        // reconcile order: bottom→top by ascending source position (everyone stays at 0)
        if (!dry) {
          const ordered = [...buildable].sort((a, b) => a.position - b.position).map((r) => idMap()[r.localRef]).filter((x): x is string => !!x);
          await port.reorderRoles(ordered);
        }
        break;
      }

      case 'expressions': {
        const emojis = snap.emojis.filter((e) => !e.managed);
        for (const e of snap.emojis.filter((x) => x.managed)) skipped.push({ ref: `emoji: ${e.name}`, reason: 'managed emoji' });
        await runReconciled('emoji', emojis.map((e) => ({ localRef: e.localRef, kind: 'emoji', name: e.name })), async (d) => {
          const e = emojis.find((x) => x.localRef === d.localRef)!;
          return port.createEmoji({ name: e.name, imageKey: e.asset, roleIds: e.roleRefs.map((r) => idMap()[r]).filter((x): x is string => !!x) });
        });
        await runReconciled('sticker', snap.stickers.map((s) => ({ localRef: s.localRef, kind: 'sticker', name: s.name })), async (d) => {
          const s = snap.stickers.find((x) => x.localRef === d.localRef)!;
          return port.createSticker({ name: s.name, description: s.description, tags: s.tags, imageKey: s.asset });
        });
        break;
      }

      case 'categories': {
        await runReconciled('category', snap.categories.map((c) => ({ localRef: c.localRef, kind: 'category', name: c.name })), async (d) => {
          const c = snap.categories.find((x) => x.localRef === d.localRef)!;
          return port.createChannel({ type: 4, name: c.name, parentId: null, position: c.position });
        });
        break;
      }

      case 'channels': {
        await runReconciled('channel', snap.channels.map((c) => ({ localRef: c.localRef, kind: 'channel', name: c.name })), async (d) => {
          const c = snap.channels.find((x) => x.localRef === d.localRef)!;
          return port.createChannel({
            type: TYPE_OF_KIND[c.kind],
            name: c.name,
            parentId: c.categoryRef ? idMap()[c.categoryRef] ?? null : null,
            position: c.position,
            topic: c.topic,
            nsfw: c.nsfw,
            rateLimitPerUser: c.rateLimitPerUser,
            bitrate: c.bitrate,
            userLimit: c.userLimit,
            rtcRegion: c.rtcRegion,
            videoQualityMode: c.videoQualityMode,
            defaultForumLayout: c.defaultForumLayout,
            defaultSortOrder: c.defaultSortOrder,
            defaultThreadRateLimitPerUser: c.defaultThreadRateLimitPerUser,
            defaultAutoArchiveDuration: c.defaultAutoArchiveDuration,
          });
        });
        break;
      }

      case 'overwrites': {
        if (!dry) {
          const map = idMap();
          const apply = async (channelRef: string, ows: Snapshot['channels'][number]['overwrites']) => {
            const channelId = map[channelRef];
            if (!channelId) return;
            const raw: RawOverwrite[] = [];
            for (const o of ows) {
              if (o.targetType === 'member') {
                skipped.push({ ref: `${channelRef} overwrite`, reason: 'member overwrite skipped (no members yet)' });
                continue;
              }
              const targetId = map[o.targetRef];
              if (!targetId) {
                skipped.push({ ref: `${channelRef} overwrite`, reason: `unresolved role ref ${o.targetRef}` });
                continue;
              }
              raw.push({ id: targetId, type: 0, allow: o.allow, deny: o.deny });
            }
            await port.setChannelOverwrites(channelId, raw);
          };
          for (const c of snap.categories) await apply(c.localRef, c.overwrites);
          for (const c of snap.channels) await apply(c.localRef, c.overwrites);
        }
        break;
      }

      case 'automod': {
        const map = idMap();
        await runReconciled('automod', snap.automod.map((a) => ({ localRef: a.localRef, kind: 'automod', name: a.name })), async (d) => {
          const a = snap.automod.find((x) => x.localRef === d.localRef)!;
          return port.createAutoModRule({
            name: a.name,
            eventType: a.eventType,
            triggerType: a.triggerType,
            triggerMetadata: a.triggerMetadata,
            actions: a.actions.map((ac) => ({
              type: ac.type,
              metadata: {
                ...(ac.customMessage ? { customMessage: ac.customMessage } : {}),
                ...(ac.alertChannelRef && map[ac.alertChannelRef] ? { channelId: map[ac.alertChannelRef] } : {}),
                ...(ac.durationSeconds != null ? { durationSeconds: ac.durationSeconds } : {}),
              },
            })),
            enabled: a.enabled,
            exemptRoles: a.exemptRoleRefs.map((r) => map[r]).filter((x): x is string => !!x),
            exemptChannels: a.exemptChannelRefs.map((r) => map[r]).filter((x): x is string => !!x),
          });
        });
        break;
      }

      case 'pointers': {
        if (!dry) {
          const map = idMap();
          const ref = (r: string | null) => (r ? map[r] ?? null : null);
          await port.setGuildPointers({
            systemChannelId: ref(snap.guild.systemChannelRef),
            rulesChannelId: ref(snap.guild.rulesChannelRef),
            publicUpdatesChannelId: ref(snap.guild.publicUpdatesChannelRef),
            afkChannelId: ref(snap.guild.afkChannelRef),
          });
          if (snap.guild.welcomeScreen) {
            await port.setWelcomeScreen({
              enabled: snap.guild.welcomeScreen.enabled,
              description: snap.guild.welcomeScreen.description,
              welcomeChannels: snap.guild.welcomeScreen.welcomeChannels
                .map((wc) => {
                  const id = map[wc.channelRef];
                  return id ? { channelId: id, description: wc.description, emojiId: null, emojiName: wc.emojiUnicode } : null;
                })
                .filter((x): x is NonNullable<typeof x> => !!x),
            });
          }
        }
        break;
      }

      case 'content': {
        // Reconciled + resumable so a crash mid-content (or a stalled re-delivery, which BullMQ does
        // regardless of `attempts`) never re-creates the webhook or re-posts already-sent messages.
        if (!dry) {
          const map = idMap();
          for (const cc of snap.content) {
            const ch = snap.channels.find((c) => c.localRef === cc.channelRef);
            if (!ch?.copyContent) continue;
            const channelId = map[cc.channelRef];
            if (!channelId) continue;

            // Adopt the webhook from the manifest if a prior attempt created it; else create + record it.
            const hookRef = `webhook_${cc.channelRef}`;
            const priorHook = entries.find((e) => e.localRef === hookRef && e.newId);
            let hook: { id: string; token: string };
            if (priorHook?.newId) {
              const sep = priorHook.newId.indexOf(':');
              hook = { id: priorHook.newId.slice(0, sep), token: priorHook.newId.slice(sep + 1) };
            } else {
              hook = await port.createWebhook(channelId, opts.serverIdentityName ?? 'Disco');
              entries = [
                ...entries.filter((e) => e.localRef !== hookRef),
                { localRef: hookRef, kind: 'webhook', newId: `${hook.id}:${hook.token}`, status: 'created', note: null },
              ];
              checkpoint();
            }

            // Resume from the count of already-posted messages (persisted in idMap under a content_ key).
            const postedKey = `content_${cc.channelRef}`;
            const already = Number(manifest.idMap[postedKey] ?? '0');
            for (let i = already; i < cc.messages.length; i++) {
              const m = cc.messages[i]!;
              const identityName = opts.contentIdentity === 'server' ? (opts.serverIdentityName ?? 'Server') : m.authorName;
              const msg: RawMessage = {
                id: '',
                author: { username: identityName, avatarUrl: m.authorAvatarUrl, bot: false },
                content: mentionsToIds(m.content, map),
                embeds: m.embeds.map((e) => ({
                  title: e.title,
                  description: e.description ? mentionsToIds(e.description, map) : e.description,
                  url: e.url,
                  color: e.color,
                  author: e.authorName ? { name: e.authorName, url: e.authorUrl ?? undefined, iconUrl: e.authorIconUrl ?? undefined } : null,
                  footer: e.footerText ? { text: e.footerText, iconUrl: e.footerIconUrl ?? undefined } : null,
                  image: e.imageUrl ? { url: e.imageUrl } : null,
                  thumbnail: e.thumbnailUrl ? { url: e.thumbnailUrl } : null,
                  timestamp: e.timestamp,
                  fields: e.fields.map((f) => ({ name: f.name, value: mentionsToIds(f.value, map), inline: f.inline })),
                })),
                pinned: m.pinned,
                componentSummary: m.componentSummary,
                createdAt: m.createdAt,
              };
              await port.executeWebhook(hook, msg);
              // Checkpoint the posted count BEFORE the next post, so a crash resumes at i+1.
              manifest.idMap[postedKey] = String(i + 1);
              checkpoint();
            }
          }
        }
        break;
      }

      case 'bot_detection':
      case 'report':
        break;
    }

    markStep(step, 'done');
    log(`done ${step}`);
  }

  manifest.entries = entries;
  manifest.idMap = idMap();

  const { steps: manual, warnings } = manualSteps(snap);
  const report: RebuildReport = {
    jobId: manifest.jobId,
    dryRun: dry,
    targetGuildId: manifest.targetGuildId,
    counts: stepCounts(snap),
    created,
    updated,
    skipped,
    manualSteps: manual,
    botChecklist: snap.bots.map((b) => `${b.name}${b.vendorGuess ? ` (${b.vendorGuess})` : ''}`),
    botSetup: generateBotSetup(snap.bots),
    warnings,
    generatedAt,
  };

  return { manifest, report };
}
