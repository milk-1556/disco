import { z } from 'zod';
import { AssetKey, HexColor, Url } from './primitives.js';

/** One find/replace rule applied to names, topics, copy, and (smartly) url slugs (§4). */
export const FindReplaceRule = z.object({
  from: z.string().min(1),
  to: z.string(),
  caseInsensitive: z.boolean().default(true),
  /**
   * When true, swap whole display words AND url slugs (`old` -> `new`, `/old/` -> `/new/`,
   * `OldHQ` -> `NewHQ`) without corrupting unrelated substrings (won't turn "bold" into "bnew").
   */
  wholeWordSmart: z.boolean().default(true),
});
export type FindReplaceRule = z.infer<typeof FindReplaceRule>;

export const ColorMapRule = z.object({ from: HexColor, to: HexColor });
export const LinkMapRule = z.object({ from: Url, to: Url });

export const RebrandAssets = z.object({
  icon: AssetKey.optional(),
  banner: AssetKey.optional(),
  splash: AssetKey.optional(),
});

/** The deterministic transform input. `Snapshot + RebrandConfig -> RebrandedSnapshot` (§4). */
export const RebrandConfig = z.object({
  clientId: z.string(),
  /** Optional new server name; when omitted, only findReplace affects the name. */
  serverName: z.string().min(2).max(100).optional(),
  findReplace: z.array(FindReplaceRule).default([]),
  colorMap: z.array(ColorMapRule).default([]),
  linkMap: z.array(LinkMapRule).default([]),
  assets: RebrandAssets.default({}),
});
export type RebrandConfig = z.infer<typeof RebrandConfig>;

/** A saved client record — reused for repeat work and upsells (§4, §7). */
export const Client = z.object({
  id: z.string(),
  creatorName: z.string(),
  handle: z.string().default(''),
  brandColors: z.array(HexColor).default([]),
  links: z.array(Url).default([]),
  assets: RebrandAssets.default({}),
  /** Saved term swaps captured from intake. */
  termSwaps: z.array(z.object({ from: z.string(), to: z.string() })).default([]),
  notes: z.string().default(''),
  /** Deal economics — what this client is worth. */
  buildPrice: z.number().min(0).default(0), // one-time server build fee
  monthlyRetainer: z.number().min(0).default(0), // recurring management/maintenance fee ($/mo)
  upsells: z.array(z.object({ name: z.string(), price: z.number().min(0) })).default([]), // one-time add-ons
  createdAt: z.string(),
});
export type Client = z.infer<typeof Client>;

/** One row of the side-by-side Rebrand Preview (old value -> new value) (§4). */
export const RebrandChange = z.object({
  path: z.string(), // e.g. "guild.name", "channels[#welcome].topic", "roles[VIP].name"
  field: z.string(),
  before: z.string(),
  after: z.string(),
  /** Which rule produced the change, for traceability. */
  rule: z.enum(['serverName', 'findReplace', 'colorMap', 'linkMap', 'asset']),
});
export type RebrandChange = z.infer<typeof RebrandChange>;

export const RebrandPreview = z.object({
  changes: z.array(RebrandChange).default([]),
  unchangedTokens: z.array(z.string()).default([]),
});
export type RebrandPreview = z.infer<typeof RebrandPreview>;
