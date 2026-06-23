import type { FindReplaceRule } from '@disco/schema';

const WORD = /[A-Za-z0-9]/;

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD.test(ch);
}
function isUpper(ch: string | undefined): boolean {
  return ch !== undefined && ch >= 'A' && ch <= 'Z';
}
function isLowerOrDigit(ch: string | undefined): boolean {
  return ch !== undefined && ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9'));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * "Whole-word-smart" boundary test for a match found at [start, end) in `text` whose
 * actual (cased) matched substring is `matched`. A boundary is valid when the adjacent
 * char is a non-word char, the string edge, OR a camelCase transition — so display words
 * and url slugs swap (`OldHQ`→`NewHQ`, `/old/`→`/new/`) but inner substrings don't
 * (`bold` is never touched by `old`).
 */
function smartBoundaryOk(text: string, start: number, end: number, matched: string): boolean {
  const prev = start > 0 ? text[start - 1] : undefined;
  const next = end < text.length ? text[end] : undefined;
  const first = matched[0];
  const last = matched[matched.length - 1];

  const leftOk =
    start === 0 ||
    !isWordChar(prev) ||
    // camel boundary: lowercase/digit run ends, an uppercase token begins
    (isLowerOrDigit(prev) && isUpper(first));

  const rightOk =
    end === text.length ||
    !isWordChar(next) ||
    // camel boundary: token ends (lower/digit) and an uppercase token begins after it
    (isLowerOrDigit(last) && isUpper(next));

  return leftOk && rightOk;
}

/** Apply a single find/replace rule to one string, returning the rewritten string. */
export function applyRule(text: string, rule: FindReplaceRule): string {
  if (!text || !rule.from) return text;
  const flags = rule.caseInsensitive ? 'gi' : 'g';
  const re = new RegExp(escapeRegExp(rule.from), flags);

  if (!rule.wholeWordSmart) {
    return text.replace(re, rule.to);
  }

  let out = '';
  let lastIndex = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    const matched = m[0];
    const end = start + matched.length;
    if (smartBoundaryOk(text, start, end, matched)) {
      out += text.slice(lastIndex, start) + rule.to;
      lastIndex = end;
    }
  }
  out += text.slice(lastIndex);
  return out;
}

/** Apply all find/replace rules in order to one string. */
export function applyFindReplace(text: string, rules: readonly FindReplaceRule[]): string {
  return rules.reduce((acc, rule) => applyRule(acc, rule), text);
}
