import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

/**
 * Object storage for snapshot asset bytes (icons, banners, emojis, stickers). The snapshot holds
 * content-addressed keys (`assets/<sha256>.<ext>`); bytes live here. Disk in dev, S3-compatible in
 * prod (same interface). Capture writes bytes; rebuild reads them for re-upload.
 */
export interface AssetStore {
  /** Store bytes, returning a content-addressed key. */
  put(bytes: Uint8Array, ext: string): Promise<string>;
  /** Store bytes at an EXACT key (used by bundle import to preserve a snapshot's asset references). */
  putAt(key: string, bytes: Uint8Array): Promise<void>;
  /** Read bytes back by key. */
  get(key: string): Promise<Buffer>;
}

function keyFor(bytes: Uint8Array, ext: string): string {
  const sha = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
  return `assets/${sha}.${ext.replace(/^\./, '') || 'bin'}`;
}

export class DiskAssetStore implements AssetStore {
  constructor(private root: string) {}
  /**
   * Resolve a key to an absolute path and PROVE it stays inside the storage root — a containment
   * backstop against a path-traversal key (`../../etc/x`) reaching writeFile/readFile, independent of
   * any caller-side validation. Throws rather than touch a file outside the root.
   */
  private safePath(key: string): string {
    const rootAbs = resolve(this.root);
    const path = resolve(rootAbs, key);
    if (path !== rootAbs && !path.startsWith(rootAbs + sep)) {
      throw new Error(`unsafe asset key escapes storage root: ${key}`);
    }
    return path;
  }
  async put(bytes: Uint8Array, ext: string): Promise<string> {
    const key = keyFor(bytes, ext);
    await this.putAt(key, bytes);
    return key;
  }
  async putAt(key: string, bytes: Uint8Array): Promise<void> {
    const path = this.safePath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }
  async get(key: string): Promise<Buffer> {
    return readFile(this.safePath(key));
  }
}

export class MemoryAssetStore implements AssetStore {
  private store = new Map<string, Buffer>();
  async put(bytes: Uint8Array, ext: string): Promise<string> {
    const key = keyFor(bytes, ext);
    this.store.set(key, Buffer.from(bytes));
    return key;
  }
  async putAt(key: string, bytes: Uint8Array): Promise<void> {
    this.store.set(key, Buffer.from(bytes));
  }
  async get(key: string): Promise<Buffer> {
    const b = this.store.get(key);
    if (!b) throw new Error(`asset not found: ${key}`);
    return b;
  }
}

/** Guess a file extension from a Discord CDN url or content-type. */
export function extFromUrl(url: string): string {
  const m = url.match(/\.(png|jpg|jpeg|gif|webp|json)(?:\?|$)/i);
  return m ? m[1]!.toLowerCase() : 'png';
}
