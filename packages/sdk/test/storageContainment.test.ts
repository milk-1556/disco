import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DiskAssetStore } from '../src/index.js';

/**
 * Regression for SEC-discbundle-pathtraversal: DiskAssetStore.putAt/get must never touch a file
 * outside the storage root, even when handed a malicious traversal key (the storage-layer backstop
 * behind the schema-level AssetKey validation on bundle import).
 */
describe('DiskAssetStore path-traversal containment', () => {
  let root: string;
  let store: DiskAssetStore;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'disco-store-'));
    store = new DiskAssetStore(root);
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes a legitimate content-addressed key', async () => {
    await store.putAt('assets/deadbeefdeadbeef.png', new Uint8Array([1, 2, 3]));
    expect(await store.get('assets/deadbeefdeadbeef.png')).toEqual(Buffer.from([1, 2, 3]));
  });

  for (const evil of ['../escape.txt', '../../etc/cron.d/x', 'assets/../../escape.txt', '/etc/passwd']) {
    it(`rejects a traversal key and writes nothing: ${evil}`, async () => {
      await expect(store.putAt(evil, new Uint8Array([9, 9, 9]))).rejects.toThrow(/unsafe asset key/i);
      // prove no file landed outside the root
      await expect(readFile(join(root, '..', 'escape.txt'))).rejects.toThrow();
    });
    it(`rejects a traversal key on read: ${evil}`, async () => {
      await expect(store.get(evil)).rejects.toThrow(/unsafe asset key/i);
    });
  }
});
