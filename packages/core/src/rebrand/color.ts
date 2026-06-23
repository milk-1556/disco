/** Color helpers: Discord stores colors as 24-bit ints; operators think in hex. */

/** Normalize a hex string to lowercase `rrggbb` (no leading #). */
export function normalizeHex(hex: string): string {
  return hex.replace(/^#/, '').toLowerCase();
}

/** `#7C3AED` | `7c3aed` -> 8141037. Returns null for invalid input. */
export function hexToInt(hex: string): number | null {
  const h = normalizeHex(hex);
  if (!/^[0-9a-f]{6}$/.test(h)) return null;
  return parseInt(h, 16);
}

/** 8141037 -> `#7c3aed`. */
export function intToHex(value: number): string {
  return `#${(value & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** True if two hex strings denote the same color regardless of `#`/case. */
export function hexEquals(a: string, b: string): boolean {
  return normalizeHex(a) === normalizeHex(b);
}
