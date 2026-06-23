import { createHash } from 'node:crypto';
import { DiscoBundle, type RebrandConfig, type Snapshot } from '@disco/schema';

/** Every object-storage asset key referenced by a snapshot (icons/banners/emojis/stickers). */
export function collectAssetKeys(snapshot: Snapshot): string[] {
  const keys = new Set<string>();
  const a = snapshot.guild.assets;
  for (const k of [a.icon, a.banner, a.splash, a.discoverySplash]) if (k) keys.add(k);
  for (const e of snapshot.emojis) keys.add(e.asset);
  for (const s of snapshot.stickers) keys.add(s.asset);
  return [...keys];
}

/** Deterministic JSON serialization (sorted keys) so the checksum is stable across re-parses. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

interface BundleContent {
  name: string;
  exportedAt: string;
  snapshot: Snapshot;
  config?: RebrandConfig;
  assets: Record<string, string>;
}

/** sha256 over the canonical content (everything but the checksum field itself). */
function checksumOf(c: BundleContent): string {
  return createHash('sha256').update(stableStringify(c)).digest('hex');
}

export interface ExportBundleInput {
  snapshot: Snapshot;
  config?: RebrandConfig;
  /** Embedded asset bytes (key → base64). Empty bundle still imports; assets just won't re-upload. */
  assets?: Record<string, string>;
  name?: string;
  exportedAt: string;
}

/** Build a portable, checksummed `.discobundle` from a snapshot (+ optional config + asset bytes). */
export function exportBundle(input: ExportBundleInput): DiscoBundle {
  const content: BundleContent = {
    name: input.name ?? input.snapshot.source.name,
    exportedAt: input.exportedAt,
    snapshot: input.snapshot,
    ...(input.config ? { config: input.config } : {}),
    assets: input.assets ?? {},
  };
  return DiscoBundle.parse({ discobundle: '1', checksum: checksumOf(content), ...content });
}

export class BundleError extends Error {}

/**
 * Validate + verify a `.discobundle`: schema-check, then recompute the checksum and reject on
 * tamper/corruption. Returns the trusted snapshot (+ config + assets) for import.
 */
export function parseBundle(raw: unknown): { snapshot: Snapshot; config?: RebrandConfig; assets: Record<string, string>; name: string } {
  const parsed = DiscoBundle.safeParse(raw);
  if (!parsed.success) throw new BundleError(`not a valid .discobundle: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`);
  const b = parsed.data;
  const recomputed = checksumOf({
    name: b.name,
    exportedAt: b.exportedAt,
    snapshot: b.snapshot,
    ...(b.config ? { config: b.config } : {}),
    assets: b.assets,
  });
  if (recomputed !== b.checksum) throw new BundleError('checksum mismatch — the bundle was modified or corrupted');
  return { snapshot: b.snapshot, ...(b.config ? { config: b.config } : {}), assets: b.assets, name: b.name };
}
