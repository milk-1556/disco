import { describe, expect, it } from 'vitest';
import { applyRule } from '../src/index.js';

const rule = (over: Partial<Parameters<typeof applyRule>[1]> = {}) => ({
  from: 'Old',
  to: 'New',
  caseInsensitive: true,
  wholeWordSmart: true,
  ...over,
});

describe('smart find/replace', () => {
  it('replaces standalone and boundary-delimited words', () => {
    expect(applyRule('Old', rule())).toBe('New');
    expect(applyRule('the Old server', rule())).toBe('the New server');
    expect(applyRule('Server-Old-Stuff', rule())).toBe('Server-New-Stuff');
  });

  it('replaces camelCase prefixes (OldHQ → NewHQ)', () => {
    expect(applyRule('OldHQ', rule())).toBe('NewHQ');
    expect(applyRule('OldCreator', rule({ from: 'Old', to: 'New' }))).toBe('NewCreator');
  });

  it('does NOT corrupt unrelated substrings (bold ↛ bNew)', () => {
    expect(applyRule('bold', rule({ from: 'old', to: 'new' }))).toBe('bold');
    expect(applyRule('threshold', rule({ from: 'old', to: 'new' }))).toBe('threshold');
  });

  it('swaps url slugs at path boundaries', () => {
    expect(applyRule('https://whop.com/old/vip', rule({ from: 'old', to: 'new' }))).toBe(
      'https://whop.com/new/vip',
    );
  });

  it('honors caseInsensitive flag', () => {
    expect(applyRule('OLD news', rule({ caseInsensitive: true }))).toBe('New news');
    expect(applyRule('OLD news', rule({ caseInsensitive: false }))).toBe('OLD news');
  });

  it('non-smart mode does a plain replace', () => {
    expect(applyRule('bold', rule({ from: 'old', to: 'new', wholeWordSmart: false }))).toBe('bnew');
  });
});
