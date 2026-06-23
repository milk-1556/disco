import type {
  RebrandChange,
  RebrandConfig,
  RebrandPreview,
  Snapshot,
} from '@disco/schema';
import { hexEquals, hexToInt, intToHex } from './color.js';
import { applyFindReplace } from './findReplace.js';

export interface RebrandResult {
  snapshot: Snapshot;
  preview: RebrandPreview;
}

interface Ctx {
  config: RebrandConfig;
  changes: RebrandChange[];
}

/** Apply linkMap (exact url swaps) then findReplace to a text field, recording each change. */
function rewriteText(
  value: string | null | undefined,
  ctx: Ctx,
  path: string,
  field: string,
): string | null {
  if (value === null || value === undefined || value === '') return value ?? null;
  let current = value;

  // 1) linkMap — exact url substring swaps
  if (ctx.config.linkMap.length) {
    let afterLink = current;
    for (const rule of ctx.config.linkMap) {
      afterLink = afterLink.split(rule.from).join(rule.to);
    }
    if (afterLink !== current) {
      ctx.changes.push({ path, field, before: current, after: afterLink, rule: 'linkMap' });
      current = afterLink;
    }
  }

  // 2) findReplace — smart word/slug swaps
  if (ctx.config.findReplace.length) {
    const afterFr = applyFindReplace(current, ctx.config.findReplace);
    if (afterFr !== current) {
      ctx.changes.push({ path, field, before: current, after: afterFr, rule: 'findReplace' });
      current = afterFr;
    }
  }
  return current;
}

/** Map a Discord color int through colorMap, recording the change. */
function rewriteColor(value: number | null, ctx: Ctx, path: string, field: string): number | null {
  if (value === null || value === 0) return value;
  const asHex = intToHex(value);
  for (const rule of ctx.config.colorMap) {
    if (hexEquals(rule.from, asHex)) {
      const to = hexToInt(rule.to);
      if (to !== null && to !== value) {
        ctx.changes.push({ path, field, before: asHex, after: `#${normalize(rule.to)}`, rule: 'colorMap' });
        return to;
      }
    }
  }
  return value;
}

function normalize(hex: string): string {
  return hex.replace(/^#/, '').toLowerCase();
}

/**
 * Deterministic rebrand transform: `Snapshot + RebrandConfig -> RebrandedSnapshot` plus a
 * side-by-side preview of every change (§4). Pure — never mutates its input, so re-running with
 * an edited config always regenerates cleanly from the ORIGINAL snapshot (idempotent & reversible
 * at the config level). Callers must always pass the original snapshot, never a rebranded one.
 */
export function rebrand(original: Snapshot, config: RebrandConfig): RebrandResult {
  const snap: Snapshot = structuredClone(original);
  const ctx: Ctx = { config, changes: [] };

  // ── Guild name: explicit override wins; otherwise apply text rules ──
  if (config.serverName && config.serverName !== snap.guild.name) {
    ctx.changes.push({
      path: 'guild',
      field: 'name',
      before: snap.guild.name,
      after: config.serverName,
      rule: 'serverName',
    });
    snap.guild.name = config.serverName;
  } else {
    snap.guild.name = rewriteText(snap.guild.name, ctx, 'guild', 'name') ?? snap.guild.name;
  }

  // ── Welcome screen text ──
  if (snap.guild.welcomeScreen) {
    snap.guild.welcomeScreen.description = rewriteText(
      snap.guild.welcomeScreen.description,
      ctx,
      'guild.welcomeScreen',
      'description',
    );
    snap.guild.welcomeScreen.welcomeChannels.forEach((wc, i) => {
      wc.description =
        rewriteText(wc.description, ctx, `guild.welcomeScreen.channels[${i}]`, 'description') ??
        wc.description;
    });
  }

  // ── Asset overrides ──
  for (const key of ['icon', 'banner', 'splash'] as const) {
    const next = config.assets[key];
    if (next && next !== snap.guild.assets[key]) {
      ctx.changes.push({
        path: 'guild.assets',
        field: key,
        before: snap.guild.assets[key] ?? '(none)',
        after: next,
        rule: 'asset',
      });
      snap.guild.assets[key] = next;
    }
  }

  // ── Roles: names + colors ──
  for (const role of snap.roles) {
    const p = `roles[${role.localRef}]`;
    role.name = rewriteText(role.name, ctx, p, 'name') ?? role.name;
    role.colors.primary = rewriteColor(role.colors.primary, ctx, p, 'colors.primary') ?? role.colors.primary;
    role.colors.secondary = rewriteColor(role.colors.secondary, ctx, p, 'colors.secondary');
    role.colors.tertiary = rewriteColor(role.colors.tertiary, ctx, p, 'colors.tertiary');
  }

  // ── Categories & channels: names + topics ──
  for (const cat of snap.categories) {
    cat.name = rewriteText(cat.name, ctx, `categories[${cat.localRef}]`, 'name') ?? cat.name;
  }
  for (const ch of snap.channels) {
    const p = `channels[${ch.localRef}]`;
    ch.name = rewriteText(ch.name, ctx, p, 'name') ?? ch.name;
    ch.topic = rewriteText(ch.topic, ctx, p, 'topic');
    ch.forumTags.forEach((t, i) => {
      t.name = rewriteText(t.name, ctx, `${p}.forumTags[${i}]`, 'name') ?? t.name;
    });
  }

  // ── Emojis & stickers: names (+ sticker description) ──
  for (const e of snap.emojis) {
    e.name = rewriteText(e.name, ctx, `emojis[${e.localRef}]`, 'name') ?? e.name;
  }
  for (const s of snap.stickers) {
    const p = `stickers[${s.localRef}]`;
    s.name = rewriteText(s.name, ctx, p, 'name') ?? s.name;
    s.description = rewriteText(s.description, ctx, p, 'description');
  }

  // ── AutoMod rule names ──
  for (const r of snap.automod) {
    r.name = rewriteText(r.name, ctx, `automod[${r.localRef}]`, 'name') ?? r.name;
  }

  // ── Copied system-channel content: message text + every embed field ──
  for (const cc of snap.content) {
    cc.messages.forEach((m, mi) => {
      const p = `content[${cc.channelRef}].messages[${mi}]`;
      m.content = rewriteText(m.content, ctx, p, 'content') ?? m.content;
      m.embeds.forEach((emb, ei) => {
        const ep = `${p}.embeds[${ei}]`;
        emb.title = rewriteText(emb.title, ctx, ep, 'title');
        emb.description = rewriteText(emb.description, ctx, ep, 'description');
        emb.url = rewriteText(emb.url, ctx, ep, 'url');
        emb.authorName = rewriteText(emb.authorName, ctx, ep, 'authorName');
        emb.authorUrl = rewriteText(emb.authorUrl, ctx, ep, 'authorUrl');
        emb.footerText = rewriteText(emb.footerText, ctx, ep, 'footerText');
        emb.imageUrl = rewriteText(emb.imageUrl, ctx, ep, 'imageUrl');
        emb.thumbnailUrl = rewriteText(emb.thumbnailUrl, ctx, ep, 'thumbnailUrl');
        emb.color = rewriteColor(emb.color, ctx, ep, 'color');
        emb.fields.forEach((f, fi) => {
          f.name = rewriteText(f.name, ctx, `${ep}.fields[${fi}]`, 'name') ?? f.name;
          f.value = rewriteText(f.value, ctx, `${ep}.fields[${fi}]`, 'value') ?? f.value;
        });
      });
    });
  }

  return { snapshot: snap, preview: { changes: ctx.changes, unchangedTokens: unchanged(snap, config) } };
}

/** Brand tokens that no rule touched — surfaced so the operator sees what is NOT being swapped. */
function unchanged(snap: Snapshot, config: RebrandConfig): string[] {
  const out: string[] = [];
  for (const tok of snap.brandTokens) {
    let covered = false;
    if (tok.kind === 'name') {
      covered = config.findReplace.some((r) => tok.value.toLowerCase().includes(r.from.toLowerCase()));
    } else if (tok.kind === 'color') {
      covered = config.colorMap.some((r) => hexEquals(r.from, tok.value));
    } else if (tok.kind === 'url') {
      covered = config.linkMap.some((r) => tok.value.includes(r.from));
    }
    if (!covered) out.push(tok.value);
  }
  return out;
}
