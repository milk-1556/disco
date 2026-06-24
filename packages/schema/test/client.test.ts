import { describe, expect, it } from 'vitest';
import { Client } from '../src/index.js';

/**
 * The Client record carries deal economics (buildPrice/monthlyRetainer/upsells). These are optional
 * on intake and default to a zero/empty deal so a half-filled form still parses; this pins those
 * defaults and their min(0) guards.
 */
describe('Client schema deal economics', () => {
  const minimal = { id: 'client_x', creatorName: 'Vega', createdAt: '2026-06-22T00:00:00.000Z' };

  it('defaults buildPrice, monthlyRetainer to 0 and upsells to []', () => {
    const c = Client.parse(minimal);
    expect(c.buildPrice).toBe(0);
    expect(c.monthlyRetainer).toBe(0);
    expect(c.upsells).toEqual([]);
  });

  it('preserves provided deal values and upsells', () => {
    const c = Client.parse({
      ...minimal,
      buildPrice: 5000,
      monthlyRetainer: 750,
      upsells: [{ name: 'Custom bot', price: 1200 }],
    });
    expect(c.buildPrice).toBe(5000);
    expect(c.monthlyRetainer).toBe(750);
    expect(c.upsells).toEqual([{ name: 'Custom bot', price: 1200 }]);
  });

  it('rejects negative prices', () => {
    expect(() => Client.parse({ ...minimal, buildPrice: -1 })).toThrow();
    expect(() => Client.parse({ ...minimal, monthlyRetainer: -1 })).toThrow();
    expect(() => Client.parse({ ...minimal, upsells: [{ name: 'x', price: -5 }] })).toThrow();
  });
});
