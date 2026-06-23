export function cx(...parts: (string | false | undefined | null)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function intToHex(value: number): string {
  return `#${(value & 0xffffff).toString(16).padStart(6, '0')}`;
}

export function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 6)}…${id.slice(-3)}` : id;
}

const KIND_ICON: Record<string, string> = {
  text: '#',
  voice: '🔊',
  announcement: '📣',
  forum: '🗂',
  stage: '🎙',
  media: '🖼',
  category: '▸',
};
export function channelGlyph(kind: string): string {
  return KIND_ICON[kind] ?? '#';
}
