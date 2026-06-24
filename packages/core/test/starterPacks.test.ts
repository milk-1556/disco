import { describe, expect, it } from 'vitest';
import { auditBuildLimits, makeStarterPacks } from '../src/index.js';

describe('curated starter-pack templates (#15)', () => {
  const packs = makeStarterPacks();

  it('ships three distinct, sellable packs', () => {
    expect(packs.map((p) => p.key).sort()).toEqual(['irl', 'slots', 'sponsor']);
    // Distinct structures, not three copies.
    const shapes = packs.map((p) => `${p.snapshot.categories.length}/${p.snapshot.channels.length}/${p.snapshot.roles.length}`);
    expect(new Set(shapes).size).toBe(3);
    for (const p of packs) {
      expect(p.title).toBeTruthy();
      expect(p.pitch).toBeTruthy();
      expect(p.snapshot.categories.length).toBeGreaterThanOrEqual(5);
      expect(p.snapshot.channels.length).toBeGreaterThanOrEqual(15);
      expect(p.snapshot.roles.length).toBeGreaterThanOrEqual(8);
    }
  });

  it('every pack is tier-0 friendly — builds cleanly into a fresh guild with no hard blocks', () => {
    for (const p of packs) {
      const feasibility = auditBuildLimits(p.snapshot, 0);
      expect(feasibility.ok).toBe(true); // no hard blocks (roles/channels under the limit)
      // tier-0 friendly: no boost-locked banner/splash findings (packs use icon only)
      expect(feasibility.findings.some((f) => f.name === 'Server banner')).toBe(false);
    }
  });
});
