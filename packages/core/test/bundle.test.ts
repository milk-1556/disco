import { describe, expect, it } from 'vitest';
import { BundleError, exportBundle, makeSampleConfig, makeSampleSnapshot, parseBundle } from '../src/index.js';

describe('export/import .discobundle (§7)', () => {
  it('round-trips a snapshot + config losslessly', () => {
    const snapshot = makeSampleSnapshot();
    const config = makeSampleConfig();
    const bundle = exportBundle({ snapshot, config, assets: { 'assets/aaaa1111.png': 'YWJj' }, exportedAt: '2026-06-23T00:00:00.000Z' });
    expect(bundle.discobundle).toBe('1');

    const back = parseBundle(bundle);
    expect(back.snapshot).toEqual(snapshot);
    expect(back.config).toEqual(config);
    expect(back.assets['assets/aaaa1111.png']).toBe('YWJj');
  });

  it('round-trips through JSON serialization (the on-disk form)', () => {
    const bundle = exportBundle({ snapshot: makeSampleSnapshot(), exportedAt: '2026-06-23T00:00:00.000Z' });
    const onDisk = JSON.parse(JSON.stringify(bundle));
    const back = parseBundle(onDisk);
    expect(back.snapshot.guild.name).toBe('Acme Slots HQ');
    expect(back.config).toBeUndefined();
  });

  it('rejects a tampered bundle (checksum mismatch)', () => {
    const bundle = exportBundle({ snapshot: makeSampleSnapshot(), exportedAt: '2026-06-23T00:00:00.000Z' });
    const tampered = { ...bundle, snapshot: { ...bundle.snapshot, guild: { ...bundle.snapshot.guild, name: 'Hijacked HQ' } } };
    expect(() => parseBundle(tampered)).toThrow(BundleError);
  });

  it('rejects non-bundles', () => {
    expect(() => parseBundle({ hello: 'world' })).toThrow(BundleError);
    expect(() => parseBundle(null)).toThrow(BundleError);
  });
});
