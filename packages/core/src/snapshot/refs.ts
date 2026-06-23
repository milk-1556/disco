/** Stable, collision-free localRef allocator: `<prefix>_<slug>` with numeric disambiguation. */
export class RefAllocator {
  private used = new Set<string>();

  alloc(prefix: string, name: string): string {
    const slug =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40) || 'x';
    let candidate = `${prefix}_${slug}`;
    let n = 2;
    while (this.used.has(candidate)) candidate = `${prefix}_${slug}_${n++}`;
    this.used.add(candidate);
    return candidate;
  }
}

const CHANNEL_MENTION = /<#(\d{15,21})>/g;
const EMOJI_MENTION = /<(a?):([A-Za-z0-9_]+):(\d{15,21})>/g;

/** Rewrite raw `<#id>` / `<:name:id>` to portable localRef form so they survive into a new guild. */
export function mentionsToRefs(
  text: string,
  channelIdToRef: Map<string, string>,
  emojiIdToRef: Map<string, string>,
): string {
  return text
    .replace(CHANNEL_MENTION, (m, id: string) => {
      const ref = channelIdToRef.get(id);
      return ref ? `<#${ref}>` : m;
    })
    .replace(EMOJI_MENTION, (m, anim: string, name: string, id: string) => {
      const ref = emojiIdToRef.get(id);
      return ref ? `<${anim}:${name}:${ref}>` : m;
    });
}

/** Rewrite portable `<#ref>` / `<:name:ref>` back to real `<#newId>` using the rebuild idMap. */
export function mentionsToIds(text: string, idMap: Record<string, string>): string {
  return text
    .replace(/<#([a-z0-9_]+)>/gi, (m, ref: string) => {
      const id = idMap[ref];
      return id ? `<#${id}>` : m;
    })
    .replace(/<(a?):([A-Za-z0-9_]+):([a-z0-9_]+)>/gi, (m, anim: string, name: string, ref: string) => {
      const id = idMap[ref];
      return id ? `<${anim}:${name}:${id}>` : m;
    });
}
