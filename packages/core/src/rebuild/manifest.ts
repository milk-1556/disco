import type { JobManifest, ManifestEntry, Snowflake } from '@disco/schema';

export type ReconcileKind = ManifestEntry['kind'];

/** A target object we intend to exist after a build step. */
export interface DesiredObject {
  localRef: string;
  kind: ReconcileKind;
  /** Used to re-discover an object created by a previous (crashed) run when no manifest id exists. */
  name: string;
}

export type ReconcileAction = 'create' | 'update' | 'skip';

export interface ReconcilePlanItem {
  localRef: string;
  kind: ReconcileKind;
  name: string;
  action: ReconcileAction;
  /** Existing Discord id to update/adopt, when known. */
  newId: Snowflake | null;
  note: string | null;
}

export interface ReconcileResult {
  items: ReconcilePlanItem[];
  entries: ManifestEntry[];
}

const keyOf = (kind: string, name: string) => `${kind}:${name.toLowerCase()}`;

/**
 * The idempotency core (§6). Given the objects we want and the prior manifest plus any objects that
 * already exist in the target guild (keyed by kind+name), decide create/update/skip for each — so a
 * half-finished build resumes without duplicating, and re-running a completed build updates in place.
 *
 * Match priority: existing manifest entry with an id  →  existing target object by kind+name  →  create.
 * Pure: returns a fresh entry list, never mutates inputs.
 */
export function reconcile(
  desired: readonly DesiredObject[],
  manifest: Pick<JobManifest, 'entries'>,
  existingByKey: ReadonlyMap<string, Snowflake> = new Map(),
): ReconcileResult {
  const priorByRef = new Map(manifest.entries.map((e) => [e.localRef, e]));
  const items: ReconcilePlanItem[] = [];
  const entries: ManifestEntry[] = [];

  for (const d of desired) {
    const prior = priorByRef.get(d.localRef);

    if (prior?.newId) {
      // Already created in a previous run → update in place.
      items.push({ ...d, action: 'update', newId: prior.newId, note: null });
      entries.push({ ...prior, status: 'updated', note: null });
      continue;
    }

    const adopted = existingByKey.get(keyOf(d.kind, d.name));
    if (adopted) {
      // Created by a crashed run but not recorded → adopt it instead of duplicating.
      items.push({ ...d, action: 'update', newId: adopted, note: 'adopted existing target object' });
      entries.push({
        localRef: d.localRef,
        kind: d.kind,
        newId: adopted,
        status: 'updated',
        note: 'adopted existing target object',
      });
      continue;
    }

    items.push({ ...d, action: 'create', newId: null, note: null });
    entries.push({ localRef: d.localRef, kind: d.kind, newId: null, status: 'pending', note: null });
  }

  return { items, entries };
}

/** Record the result of actually performing a planned item (assigns the created/updated id). */
export function commitEntry(
  entries: ManifestEntry[],
  localRef: string,
  newId: Snowflake,
  status: 'created' | 'updated',
): ManifestEntry[] {
  return entries.map((e) => (e.localRef === localRef ? { ...e, newId, status } : e));
}

/** Build the localRef→newId map from manifest entries, for downstream id rewrites. */
export function buildIdMap(entries: readonly ManifestEntry[]): Record<string, Snowflake> {
  const map: Record<string, Snowflake> = {};
  for (const e of entries) if (e.newId) map[e.localRef] = e.newId;
  return map;
}
