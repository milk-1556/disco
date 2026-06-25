import { Snapshot } from '@disco/schema';

/**
 * Snapshot composability (#5): merge a base snapshot A with an overlay B into a composite. Objects are
 * matched by NAME per collection. A-only and B-only objects are both kept; a name present in BOTH is a
 * conflict the operator resolves ('a' keeps A's version, 'b' uses B's content under A's localRef so
 * existing references stay valid). All of B's internal cross-references (every *Ref/*Refs field) are
 * remapped so the merged graph is self-consistent; the result is re-validated against the Snapshot schema.
 */
export interface MergeConflict {
  kind: string; // roles | categories | channels | emojis | stickers | automod
  name: string;
}
export type MergeResolutions = Record<string, 'a' | 'b'>; // key = `${kind}:${name}`
export interface MergeResult {
  snapshot: Snapshot;
  conflicts: MergeConflict[];
}

const MERGE_KINDS = ['roles', 'categories', 'channels', 'emojis', 'stickers', 'automod'] as const;
type MergeKind = (typeof MERGE_KINDS)[number];

/** Rewrite every cross-reference (*Ref string / *Refs array) through `rr`, leaving the object's own
 *  `localRef` identity and all non-reference data untouched. Generic so it covers every ref field. */
function deepRemap(value: unknown, rr: (ref: string) => string): unknown {
  if (Array.isArray(value)) return value.map((v) => deepRemap(v, rr));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'localRef') out[k] = v; // the object's own identity — set explicitly, never remap
      else if (k.endsWith('Refs') && Array.isArray(v)) out[k] = v.map((r) => (typeof r === 'string' ? rr(r) : r));
      // any field that holds a LocalRef target: the *Ref convention + the bot-trace `ref` (bot.ts) which
      // is a reference despite its lowercase name. (localRef above is the identity and is excluded first.)
      else if (k.endsWith('Ref') || k === 'ref') out[k] = typeof v === 'string' ? rr(v) : v;
      else out[k] = deepRemap(v, rr);
    }
    return out;
  }
  return value;
}

export function mergeSnapshots(a: Snapshot, b: Snapshot, resolutions: MergeResolutions = {}): MergeResult {
  const conflicts: MergeConflict[] = [];
  // bLocalRef → ref it becomes in the result. A name-collision points B's ref at A's existing ref (so
  // B's references to that object resolve to A's); a B-only object gets a fresh, collision-proof ref.
  const bRemap = new Map<string, string>();
  const aByName: Record<MergeKind, Map<string, { localRef: string; name: string }>> = {} as never;

  for (const kind of MERGE_KINDS) {
    const aList = a[kind] as { localRef: string; name: string }[];
    const bList = b[kind] as { localRef: string; name: string }[];
    aByName[kind] = new Map(aList.map((o) => [o.name, o]));
    for (const bObj of bList) {
      const hit = aByName[kind].get(bObj.name);
      if (hit) {
        conflicts.push({ kind, name: bObj.name });
        bRemap.set(bObj.localRef, hit.localRef); // merges into A's object
      } else {
        bRemap.set(bObj.localRef, `m_${bObj.localRef}`); // B-only → prefixed, can't collide with A's refs
      }
    }
  }

  const rr = (ref: string): string => bRemap.get(ref) ?? ref; // A's own refs aren't in the map → unchanged

  const merged: Record<string, unknown> = { ...a };
  for (const kind of MERGE_KINDS) {
    const aList = a[kind] as ({ localRef: string; name: string } & Record<string, unknown>)[];
    const bList = b[kind] as ({ localRef: string; name: string } & Record<string, unknown>)[];
    const out: unknown[] = aList.map((aObj) => {
      // a name-collision resolved 'b' → take B's content but keep A's localRef so A's references hold
      if (resolutions[`${kind}:${aObj.name}`] === 'b') {
        const bObj = bList.find((o) => o.name === aObj.name);
        if (bObj) return deepRemap({ ...bObj, localRef: aObj.localRef }, rr);
      }
      return aObj; // default: A wins
    });
    // append B-only objects, refs remapped
    for (const bObj of bList) {
      if (!aByName[kind].has(bObj.name)) out.push(deepRemap({ ...bObj, localRef: bRemap.get(bObj.localRef)! }, rr));
    }
    merged[kind] = out;
  }

  // content: A's + B-only channels' content (channelRef remapped). A channel's content stays under A.
  const aContent = a.content as { channelRef: string }[];
  const aChannelNames = aByName.channels;
  const bOnlyContent = (b.content as { channelRef: string }[])
    .filter((c) => {
      const bChan = (b.channels as { localRef: string; name: string }[]).find((ch) => ch.localRef === c.channelRef);
      return bChan ? !aChannelNames.has(bChan.name) : false; // only carry content for channels we actually added
    })
    .map((c) => deepRemap(c, rr));
  merged.content = [...aContent, ...bOnlyContent];

  // bots: union by name (A + B-only). guild settings + brandTokens + source: keep A (it's the base).
  const aBotNames = new Set((a.bots as { name: string }[]).map((x) => x.name));
  merged.bots = [...(a.bots as unknown[]), ...(b.bots as { name: string }[]).filter((x) => !aBotNames.has(x.name)).map((x) => deepRemap(x, rr))];

  return { snapshot: Snapshot.parse(merged), conflicts };
}
