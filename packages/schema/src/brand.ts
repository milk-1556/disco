import { z } from 'zod';

/**
 * An auto-extracted candidate for rebranding, surfaced in the override panel pre-filled with the
 * config default. Nothing is swapped without appearing here — full operator visibility (§4).
 */
export const BrandTokenKind = z.enum(['name', 'color', 'url']);
export type BrandTokenKind = z.infer<typeof BrandTokenKind>;

export const BrandToken = z.object({
  kind: BrandTokenKind,
  /** The detected value (a proper noun, a hex color, or a url). */
  value: z.string(),
  /** How many times it appears across the snapshot — drives ordering in the override panel. */
  occurrences: z.number().int().min(1),
  /** Where it was seen, for operator context (e.g. ["server name", "#welcome topic", "role: VIP"]). */
  sources: z.array(z.string()).default([]),
});
export type BrandToken = z.infer<typeof BrandToken>;
