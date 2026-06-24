// Self-contained "What we built" PDF deliverable. No PDF library — we write a standalone HTML
// document (its own inline <style>, no Tailwind / external deps) into a new window and call
// print(); the operator picks "Save as PDF". Light/print-friendly so it looks clean when sent to
// a client. Scope counts are derived the exact same way the delivery page does, via deliveredScope.
import type { ManualStep, RebuildReport } from '../api.js';
import { deliveredScope } from '../scope.js';

export interface PrintReportOpts {
  serverName: string;
  report: RebuildReport;
  /** Optional client/creator name, shown in the header sub-line when present. */
  clientName?: string | null;
}

// ── escaping ── never trust user-controlled strings inside the printed markup.
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// `created` refs look like "channel: general" / "role: Mod" / "guild: Acme". Split the prefix
// (kind) from the human label so we can group them the same way the app counts them.
function splitRef(ref: string): { kind: string; label: string } {
  const idx = ref.indexOf(':');
  if (idx === -1) return { kind: 'other', label: ref.trim() };
  return { kind: ref.slice(0, idx).trim().toLowerCase(), label: ref.slice(idx + 1).trim() };
}

// Human group titles for the "What's set up" section, in delivery order.
const GROUP_ORDER: { kind: string; title: string }[] = [
  { kind: 'category', title: 'Categories' },
  { kind: 'channel', title: 'Channels' },
  { kind: 'role', title: 'Roles' },
  { kind: 'emoji', title: 'Emojis' },
  { kind: 'sticker', title: 'Stickers' },
  { kind: 'automod', title: 'Auto-moderation rules' },
];

function groupCreated(created: string[]): { title: string; items: string[] }[] {
  const buckets = new Map<string, string[]>();
  for (const ref of created) {
    const { kind, label } = splitRef(ref);
    if (kind === 'guild') continue; // the server itself, surfaced in the header instead
    if (!buckets.has(kind)) buckets.set(kind, []);
    buckets.get(kind)!.push(label);
  }
  const out: { title: string; items: string[] }[] = [];
  for (const g of GROUP_ORDER) {
    const items = buckets.get(g.kind);
    if (items && items.length) out.push({ title: g.title, items });
    buckets.delete(g.kind);
  }
  // Any remaining kinds we didn't name explicitly — keep them honest rather than dropping them.
  for (const [kind, items] of buckets) {
    if (items.length) out.push({ title: kind.charAt(0).toUpperCase() + kind.slice(1), items });
  }
  return out;
}

function scopeTilesHtml(report: RebuildReport): string {
  const tiles = deliveredScope(report.created, report.botSetup.length);
  if (!tiles.length) return '';
  return `<div class="tiles">${tiles
    .map(
      (t) =>
        `<div class="tile"><div class="tile-n">${t.value}</div><div class="tile-l">${esc(
          t.label,
        )}</div></div>`,
    )
    .join('')}</div>`;
}

function setupHtml(report: RebuildReport): string {
  const groups = groupCreated(report.created);
  const botNames = report.botSetup.map((b) => b.name).filter(Boolean);
  if (!groups.length && !botNames.length) {
    return `<p class="empty">No objects were recorded for this build.</p>`;
  }
  const sections = groups.map(
    (g) =>
      `<div class="group"><div class="group-h">${esc(g.title)} <span class="group-c">${
        g.items.length
      }</span></div><div class="chips">${g.items
        .map((i) => `<span class="chip">${esc(i)}</span>`)
        .join('')}</div></div>`,
  );
  if (botNames.length) {
    sections.push(
      `<div class="group"><div class="group-h">Bots <span class="group-c">${
        botNames.length
      }</span></div><div class="chips">${botNames
        .map((n) => `<span class="chip">${esc(n)}</span>`)
        .join('')}</div></div>`,
    );
  }
  return sections.join('');
}

function manualHtml(steps: ManualStep[]): string {
  if (!steps.length) return '';
  const rows = steps
    .map(
      (s) =>
        `<li class="manual"><span class="box"></span><div><div class="manual-t">${esc(
          s.title,
        )}</div><div class="manual-r">${esc(s.reason)}</div>${
          s.category ? `<div class="manual-c">${esc(s.category)}</div>` : ''
        }</div></li>`,
    )
    .join('');
  return `<section class="block">
    <h2>Manual steps to finish</h2>
    <p class="lede">A few things Discord's API can't automate — these are surfaced honestly, never silently skipped. Each one notes why it needs a human.</p>
    <ul class="manual-list">${rows}</ul>
  </section>`;
}

function buildHtml(opts: PrintReportOpts): string {
  const { serverName, report, clientName } = opts;
  const title = esc(serverName) || 'Server build';
  const sub = clientName ? `Prepared for ${esc(clientName)}` : 'Delivery report';
  const dateStr = new Date().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const scope = scopeTilesHtml(report);
  const setup = setupHtml(report);
  const manual = manualHtml(report.manualSteps);
  const dryNote = report.dryRun
    ? `<div class="dry">Dry-run preview — these objects were planned but not yet created live.</div>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} — Build report</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" />
<style>
  :root {
    --ink: #0e0d13;
    --violet: #7c6cf0;
    --rose: #ff5a8a;
    --jade: #2faf86;
    --line: #e7e3f0;
    --muted: #6b6478;
    --faint: #908aa0;
    --paper: #ffffff;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    color: var(--ink);
    background: var(--paper);
    font-size: 13px;
    line-height: 1.5;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page { max-width: 760px; margin: 0 auto; padding: 40px 44px 56px; }
  .display { font-family: 'Space Grotesk', 'Inter', sans-serif; }

  header.report { border-bottom: 2px solid var(--ink); padding-bottom: 20px; margin-bottom: 26px; }
  .brandline { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
  .logo {
    font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 12px;
    letter-spacing: 0.14em; text-transform: uppercase; color: #fff;
    background: linear-gradient(100deg, var(--violet), var(--rose));
    padding: 4px 9px; border-radius: 6px;
  }
  .brandline .by { font-size: 11px; color: var(--faint); letter-spacing: 0.04em; }
  h1.title {
    font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 30px;
    line-height: 1.1; margin: 0 0 6px; letter-spacing: -0.01em;
  }
  .subline { font-size: 13px; color: var(--muted); display: flex; gap: 10px; flex-wrap: wrap; }
  .subline .dot { color: var(--line); }

  .dry {
    margin: 0 0 22px; padding: 9px 13px; border-radius: 8px; font-size: 12px;
    color: #8a5a00; background: #fff6e0; border: 1px solid #f1d89a;
  }

  h2 {
    font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 17px;
    margin: 0 0 4px; letter-spacing: -0.005em;
  }
  .lede { font-size: 12px; color: var(--muted); margin: 0 0 14px; max-width: 56ch; }
  .block { margin-bottom: 30px; }

  .tiles { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 6px; }
  .tile {
    flex: 1 1 92px; min-width: 92px; text-align: center; padding: 14px 8px;
    border: 1px solid var(--line); border-radius: 10px; background: #fbfaff;
  }
  .tile-n {
    font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 26px;
    line-height: 1; color: var(--violet);
  }
  .tile-l {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.07em;
    color: var(--faint); margin-top: 6px;
  }

  .group { margin-bottom: 16px; break-inside: avoid; }
  .group-h {
    font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 12.5px;
    text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink);
    margin-bottom: 7px; display: flex; align-items: center; gap: 7px;
  }
  .group-c {
    font-family: 'Inter', sans-serif; font-weight: 600; font-size: 10px;
    color: var(--violet); background: #efecff; border-radius: 20px; padding: 1px 8px;
    letter-spacing: 0;
  }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .chip {
    font-size: 11.5px; padding: 3px 9px; border-radius: 6px;
    background: #f5f3fb; border: 1px solid var(--line); color: #36313f;
  }

  .manual-list { list-style: none; margin: 0; padding: 0; }
  .manual {
    display: flex; gap: 11px; padding: 11px 0; border-top: 1px solid var(--line);
    break-inside: avoid;
  }
  .manual:first-child { border-top: none; }
  .box {
    flex: 0 0 auto; width: 15px; height: 15px; margin-top: 1px;
    border: 1.5px solid var(--rose); border-radius: 4px;
  }
  .manual-t { font-weight: 600; font-size: 13px; }
  .manual-r { font-size: 12px; color: var(--muted); margin-top: 2px; }
  .manual-c {
    display: inline-block; margin-top: 5px; font-size: 9.5px; text-transform: uppercase;
    letter-spacing: 0.06em; color: var(--rose); background: #ffeef3;
    border-radius: 5px; padding: 2px 7px;
  }

  .empty { font-size: 12px; color: var(--faint); }

  footer.report {
    margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--line);
    font-size: 11px; color: var(--faint); display: flex; justify-content: space-between; gap: 12px;
  }
  footer.report .made { font-family: 'Space Grotesk', sans-serif; }

  @media print {
    @page { margin: 14mm; }
    .page { padding: 0; max-width: none; }
    body { font-size: 12px; }
  }
</style>
</head>
<body>
  <div class="page">
    <header class="report">
      <div class="brandline">
        <span class="logo">Disco</span>
        <span class="by">Built by Disco</span>
      </div>
      <h1 class="title">${title}</h1>
      <div class="subline">
        <span>${sub}</span>
        <span class="dot">•</span>
        <span>${esc(dateStr)}</span>
      </div>
    </header>

    ${dryNote}

    ${
      scope
        ? `<section class="block">
      <h2>What's included</h2>
      <p class="lede">A snapshot of everything delivered in this build.</p>
      ${scope}
    </section>`
        : ''
    }

    <section class="block">
      <h2>What's set up</h2>
      <p class="lede">Every object created in the server, grouped by type.</p>
      ${setup}
    </section>

    ${manual}

    <footer class="report">
      <span class="made">Disco — Discord build &amp; delivery</span>
      <span>Generated ${esc(dateStr)}</span>
    </footer>
  </div>
</body>
</html>`;
}

// Trigger the browser's native print dialog ("Save as PDF") for a freshly written window. Falls
// back to a hidden iframe if the popup is blocked, and to an alert if even that fails.
function printDoc(html: string): void {
  const win = window.open('', '_blank');
  if (win) {
    win.document.open();
    win.document.write(html);
    win.document.close();
    // Give fonts/layout a tick to settle before invoking print.
    const fire = () => {
      try {
        win.focus();
        win.print();
      } catch {
        /* user can still print manually */
      }
    };
    if (win.document.readyState === 'complete') setTimeout(fire, 350);
    else win.addEventListener('load', () => setTimeout(fire, 350));
    return;
  }

  // Popup blocked — fall back to a hidden iframe in the current document.
  try {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (!doc) throw new Error('no iframe document');
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      // Leave the iframe in place briefly so the print dialog can read it.
      setTimeout(() => iframe.remove(), 60_000);
    }, 400);
  } catch {
    alert('Could not open the report for printing. Please allow pop-ups for this site and try again.');
  }
}

/** Build and print the "What we built" report. The user chooses "Save as PDF" in the print dialog. */
export function printReport(opts: PrintReportOpts): void {
  printDoc(buildHtml(opts));
}
