import { describe, expect, it } from 'vitest';
import { classifyChannels, extractBrandTokens } from '../src/index.js';
import { makeSampleSnapshot } from './fixtures.js';

describe('channel classification (§5)', () => {
  it('classifies info channels as system_content and chat as member_chat', () => {
    const snap = classifyChannels(makeSampleSnapshot());
    const byRef = Object.fromEntries(snap.channels.map((c) => [c.localRef, c]));

    // name-pattern info channels
    expect(byRef.chan_rules?.copyPolicy).toBe('system_content');
    expect(byRef.chan_rules?.copyContent).toBe(true);
    expect(byRef.chan_welcome?.copyPolicy).toBe('system_content');
    expect(byRef.chan_roleselect?.copyPolicy).toBe('system_content');

    // read-only-for-@everyone info channel (no info-y name, but Send Messages denied)
    expect(byRef.chan_secret?.copyPolicy).toBe('system_content');

    // ordinary chat is never copied
    expect(byRef.chan_general?.copyPolicy).toBe('member_chat');
    expect(byRef.chan_general?.copyContent).toBe(false);

    // voice has no copyable content
    expect(byRef.chan_lounge?.copyPolicy).toBe('member_chat');
  });
});

describe('brand-token extraction (§4)', () => {
  it('extracts the creator name, brand color and links', () => {
    const tokens = extractBrandTokens(makeSampleSnapshot());
    const names = tokens.filter((t) => t.kind === 'name').map((t) => t.value);
    const colors = tokens.filter((t) => t.kind === 'color').map((t) => t.value);
    const urls = tokens.filter((t) => t.kind === 'url').map((t) => t.value);

    expect(names).toContain('Acme');
    expect(colors).toContain('#7c3aed');
    expect(urls).toContain('https://whop.com/acme-vip');

    // results are ordered name → color → url
    const kinds = tokens.map((t) => t.kind);
    expect(kinds.indexOf('name')).toBeLessThanOrEqual(kinds.indexOf('color'));
    expect(kinds.lastIndexOf('color')).toBeLessThanOrEqual(kinds.indexOf('url') === -1 ? Infinity : kinds.indexOf('url'));
  });
});
