import { z } from 'zod';
import { AssetKey } from './primitives.js';
import { RebrandConfig } from './rebrand.js';
import { Snapshot } from './snapshot.js';

/**
 * A portable, self-contained `.discobundle` — a snapshot (+ optional RebrandConfig + embedded asset
 * bytes) plus a content checksum, so a build is reproducible even off-platform (§7). Import re-validates
 * the schema and verifies the checksum before trusting it.
 */
export const DiscoBundle = z.object({
  discobundle: z.literal('1'),
  exportedAt: z.string(),
  name: z.string().default(''),
  /** sha256 over the canonical content (snapshot + config + assets + name + exportedAt). */
  checksum: z.string(),
  snapshot: Snapshot,
  config: RebrandConfig.optional(),
  /**
   * Embedded asset bytes (object-storage key → base64), so the bundle needs nothing external. Keys are
   * constrained to the content-addressed AssetKey shape (`assets/<hex>.<ext>`) — this is the primary
   * defense against a malicious bundle smuggling a path-traversal key into the asset-write loop.
   */
  assets: z.record(AssetKey, z.string()).default({}),
});
export type DiscoBundle = z.infer<typeof DiscoBundle>;
