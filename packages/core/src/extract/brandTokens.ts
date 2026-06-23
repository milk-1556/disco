import type { BrandToken, Snapshot } from '@disco/schema';
import { intToHex } from '../rebrand/color.js';

const STOPWORDS = new Set([
  'The', 'And', 'For', 'You', 'Your', 'Our', 'New', 'All', 'Get', 'Use', 'Welcome', 'Rules',
  'Info', 'General', 'Chat', 'Voice', 'Links', 'Roles', 'Announcements', 'Server', 'Channel',
  'Read', 'Here', 'How', 'Join', 'Click', 'Click here',
]);

const URL_RE = /https?:\/\/[^\s<>()"']+/g;
const PROPER_RE = /\b[A-Z][A-Za-z0-9]{2,}\b/g;

interface Acc {
  names: Map<string, Set<string>>;
  colors: Map<string, Set<string>>;
  urls: Map<string, Set<string>>;
}

function addName(acc: Acc, raw: string | null | undefined, source: string) {
  if (!raw) return;
  for (const m of raw.matchAll(PROPER_RE)) {
    const w = m[0];
    if (STOPWORDS.has(w)) continue;
    if (!acc.names.has(w)) acc.names.set(w, new Set());
    acc.names.get(w)!.add(source);
  }
}
function addUrls(acc: Acc, raw: string | null | undefined, source: string) {
  if (!raw) return;
  for (const m of raw.matchAll(URL_RE)) {
    const u = m[0].replace(/[.,)]+$/, '');
    if (!acc.urls.has(u)) acc.urls.set(u, new Set());
    acc.urls.get(u)!.add(source);
  }
}
function addColor(acc: Acc, value: number | null, source: string) {
  if (value === null || value === 0) return;
  const hex = intToHex(value);
  if (!acc.colors.has(hex)) acc.colors.set(hex, new Set());
  acc.colors.get(hex)!.add(source);
}

/**
 * Auto-extract rebrand candidates from a snapshot (§4): frequent proper nouns across
 * server/channel/role/emoji names + topics + copied embed/message text; every role/embed
 * color; every url. Pre-filled into the override panel — nothing is swapped without appearing.
 */
export function extractBrandTokens(snap: Snapshot): BrandToken[] {
  const acc: Acc = { names: new Map(), colors: new Map(), urls: new Map() };

  addName(acc, snap.guild.name, 'server name');
  addUrls(acc, snap.guild.welcomeScreen?.description, 'welcome screen');
  addName(acc, snap.guild.welcomeScreen?.description, 'welcome screen');

  for (const r of snap.roles) {
    addName(acc, r.name, `role: ${r.name}`);
    addColor(acc, r.colors.primary, `role: ${r.name}`);
    addColor(acc, r.colors.secondary, `role: ${r.name}`);
    addColor(acc, r.colors.tertiary, `role: ${r.name}`);
  }
  for (const c of snap.categories) addName(acc, c.name, `category: ${c.name}`);
  for (const ch of snap.channels) {
    addName(acc, ch.name, `#${ch.name}`);
    addName(acc, ch.topic, `#${ch.name} topic`);
    addUrls(acc, ch.topic, `#${ch.name} topic`);
  }
  for (const e of snap.emojis) addName(acc, e.name, `emoji: ${e.name}`);

  for (const cc of snap.content) {
    for (const m of cc.messages) {
      addName(acc, m.content, `message in ${cc.channelRef}`);
      addUrls(acc, m.content, `message in ${cc.channelRef}`);
      for (const emb of m.embeds) {
        addName(acc, emb.title, `embed in ${cc.channelRef}`);
        addName(acc, emb.description, `embed in ${cc.channelRef}`);
        addUrls(acc, emb.description, `embed in ${cc.channelRef}`);
        addUrls(acc, emb.url, `embed in ${cc.channelRef}`);
        addColor(acc, emb.color, `embed in ${cc.channelRef}`);
        for (const f of emb.fields) {
          addName(acc, f.value, `embed field in ${cc.channelRef}`);
          addUrls(acc, f.value, `embed field in ${cc.channelRef}`);
        }
      }
    }
  }

  const tokens: BrandToken[] = [];
  const emit = (kind: BrandToken['kind'], map: Map<string, Set<string>>) => {
    for (const [value, sources] of map) {
      tokens.push({ kind, value, occurrences: sources.size, sources: [...sources].slice(0, 8) });
    }
  };
  emit('name', acc.names);
  emit('color', acc.colors);
  emit('url', acc.urls);

  // Deterministic order: kind, then occurrences desc, then value asc.
  const kindOrder = { name: 0, color: 1, url: 2 } as const;
  tokens.sort(
    (a, b) =>
      kindOrder[a.kind] - kindOrder[b.kind] ||
      b.occurrences - a.occurrences ||
      a.value.localeCompare(b.value),
  );
  return tokens;
}
