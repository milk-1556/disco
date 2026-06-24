// The client-facing "what's included" scope. Derived from the build report's per-object `created`
// refs ("emoji: …", "channel: …") rather than the raw build-step count keys (which are named
// `expressions`/`bot_detection` and don't line up with "emojis"/"bots") — so the delivery page
// shows accurate, human-labelled numbers that never contradict the bots-to-add list below them.
export interface ScopeTile {
  label: string;
  value: number;
}

export function deliveredScope(created: string[], botCount: number): ScopeTile[] {
  const n = (kind: string) => created.filter((c) => c.startsWith(`${kind}:`)).length;
  return [
    { label: 'channels', value: n('channel') },
    { label: 'roles', value: n('role') },
    { label: 'categories', value: n('category') },
    { label: 'emojis', value: n('emoji') },
    { label: 'stickers', value: n('sticker') },
    { label: 'auto-mod', value: n('automod') },
    { label: 'bots', value: botCount },
  ].filter((t) => t.value > 0);
}
