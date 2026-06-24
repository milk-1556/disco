import { useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  streamJobLogs,
  type BrandToken,
  type JobEvent,
  type RebrandConfig,
  type RebrandPreview,
  type RebuildReport,
  type SnapshotRecord,
} from '../api.js';
import { BotSetupList } from '../components/BotSetupList.js';
import { cx } from '../util.js';

const SPINE_STEPS = [
  ['guild_settings', 'settings'],
  ['roles', 'roles'],
  ['expressions', 'emojis'],
  ['channels', 'channels'],
  ['overwrites', 'perms'],
  ['automod', 'automod'],
  ['pointers', 'pointers'],
  ['content', 'content'],
];

// Smart prefill so the sample template shows a ready-to-edit rebrand (simulating client intake).
const SAMPLE_SWAP: Record<string, string> = {
  Acme: 'Nova',
  '#7c3aed': '#e11d48',
  'https://whop.com/acme-vip': 'https://whop.com/nova-vip',
};
const swapFor = (v: string) => SAMPLE_SWAP[v] ?? '';

interface Row {
  from: string;
  to: string;
}

export function BuildConsole({ snapshotId }: { snapshotId: string }) {
  const [rec, setRec] = useState<SnapshotRecord | null>(null);
  const [serverName, setServerName] = useState('');
  const [names, setNames] = useState<Row[]>([]);
  const [colors, setColors] = useState<Row[]>([]);
  const [links, setLinks] = useState<Row[]>([]);
  const [preview, setPreview] = useState<RebrandPreview | null>(null);
  const [rebrandedName, setRebrandedName] = useState('');

  const [events, setEvents] = useState<JobEvent[]>([]);
  const [progress, setProgress] = useState(0);
  const [activeStep, setActiveStep] = useState<string | null>(null);
  const [report, setReport] = useState<RebuildReport | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [feasibility, setFeasibility] = useState<Awaited<ReturnType<typeof api.feasibility>> | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.snapshot(snapshotId).then((r) => {
      setRec(r);
      const guildName = r.snapshot.guild.name;
      setServerName(guildName.replace(/Acme/g, 'Nova'));
      const tok = (k: BrandToken['kind']) => r.snapshot.brandTokens.filter((t) => t.kind === k);
      setNames(tok('name').slice(0, 4).map((t) => ({ from: t.value, to: swapFor(t.value) })));
      setColors(tok('color').slice(0, 3).map((t) => ({ from: t.value, to: swapFor(t.value) })));
      setLinks(tok('url').slice(0, 3).map((t) => ({ from: t.value, to: swapFor(t.value) })));
      setPreview(null);
      setReport(null);
      setEvents([]);
      setProgress(0);
    });
    api.feasibility(snapshotId).then(setFeasibility).catch(() => setFeasibility(null));
  }, [snapshotId]);

  const config: RebrandConfig = useMemo(
    () => ({
      clientId: 'client_nova',
      serverName: serverName || undefined,
      findReplace: names.filter((r) => r.from && r.to).map((r) => ({ from: r.from, to: r.to, caseInsensitive: true, wholeWordSmart: true })),
      colorMap: colors.filter((r) => r.from && r.to),
      linkMap: links.filter((r) => r.from && r.to),
      assets: {},
    }),
    [serverName, names, colors, links],
  );

  async function doPreview() {
    setErr(null);
    try {
      const r = await api.rebrandPreview(snapshotId, config);
      setPreview(r.preview);
      setRebrandedName(r.rebrandedGuildName);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function run(dryRun: boolean) {
    setErr(null);
    setRunning(true);
    setReport(null);
    setEvents([]);
    setProgress(0);
    setActiveStep(null);
    try {
      const { id } = await api.startJob({ snapshotId, config, dryRun });
      const finish = () =>
        api.job(id).then((j) => {
          setReport(j.report);
          setRunning(false);
          setProgress(1);
        });
      const stop = streamJobLogs(id, (ev) => {
        setEvents((prev) => [...prev, ev]);
        if (ev.type === 'progress' && ev.progress != null) {
          setProgress(ev.progress);
          if (ev.step) setActiveStep(ev.step);
        }
        if (ev.type === 'done' || ev.type === 'error') {
          finish();
          stop();
        }
      });
      // Polling fallback: guarantees the report lands even if the SSE stream is interrupted.
      // It does NOT stop the SSE — that would abort the log stream mid-read on fast in-process jobs.
      const poll = setInterval(async () => {
        const j = await api.job(id).catch(() => null);
        if (j && (j.status === 'completed' || j.status === 'failed')) {
          clearInterval(poll);
          finish();
        }
      }, 800);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setRunning(false);
    }
  }

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [events]);

  if (!rec) return <div className="p-8" style={{ color: 'var(--color-muted)' }}>Loading…</div>;

  const sourceName = rec.snapshot.guild.name;
  const targetName = rebrandedName || serverName || sourceName;
  const doneSteps = new Set(events.filter((e) => e.type === 'progress').map((e) => e.step));

  return (
    <div className="px-4 py-6 md:p-8 max-w-6xl rise">
      <div className="eyebrow mb-2">build console</div>

      {/* ── the signature: transform spine ── */}
      <div className="panel p-6 mb-6">
        <div className="flex items-center gap-4 spine-wrap">
          <Identity tone="source" label="source template" name={sourceName} />
          <div className="flex-1 relative spine-track">
            <div className="h-[2px] w-full rounded-full transform-bar opacity-60" />
            <div
              className="absolute top-0 left-0 h-[2px] rounded-full transform-bar transition-all"
              style={{ width: `${Math.round(progress * 100)}%`, boxShadow: '0 0 12px var(--color-client)' }}
            />
            <div className="mt-3 gap-y-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(46px, 1fr))' }}>
              {SPINE_STEPS.map(([id, label]) => {
                const lit = doneSteps.has(id) || (activeStep === id);
                return (
                  <div key={id} className="flex flex-col items-center gap-1.5">
                    <span
                      className="w-2 h-2 rounded-full transition"
                      style={{ background: lit ? 'var(--color-client)' : 'var(--color-line)', boxShadow: lit ? '0 0 8px var(--color-client)' : undefined }}
                    />
                    <span className="text-[0.6rem] mono" style={{ color: lit ? 'var(--color-bone)' : 'var(--color-faint)' }}>
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          <Identity tone="client" label="client delivery" name={targetName} />
        </div>
      </div>

      <div className="build-grid">
        {/* ── rebrand controls ── */}
        <section className="panel p-5 self-start">
          <h2 className="text-base mb-1">Rebrand</h2>
          <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
            Detected brand tokens, pre-filled. Edit any swap — nothing changes without showing here.
          </p>

          <div className="label mb-1">Server name</div>
          <input className="input mb-4" value={serverName} onChange={(e) => setServerName(e.target.value)} />

          <RowEditor title="Names & copy" tone="name" rows={names} setRows={setNames} placeholder="new name" />
          <RowEditor title="Colors" tone="color" rows={colors} setRows={setColors} placeholder="unchanged" mono />
          <RowEditor title="Links" tone="url" rows={links} setRows={setLinks} placeholder="https://…" mono />

          <button className="btn w-full justify-center mt-2" onClick={doPreview}>
            Preview changes
          </button>
        </section>

        {/* ── preview + actions + log + report ── */}
        <section className="space-y-5 build-rail">
          {err && <div className="panel-soft p-3 text-sm" style={{ color: 'var(--color-danger)' }}>{err}</div>}

          {preview && (
            <div className="panel p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base">Preview · {preview.changes.length} changes</h2>
                {preview.unchangedTokens.length > 0 && (
                  <span className="chip">{preview.unchangedTokens.length} token(s) untouched</span>
                )}
              </div>
              <div className="space-y-1.5 max-h-64 overflow-auto pr-1">
                {preview.changes.map((c, i) => (
                  <div key={i} className="panel-soft px-3 py-2 flex items-center gap-3 text-sm">
                    <span className="chip" style={{ minWidth: 76, justifyContent: 'center' }}>{c.rule}</span>
                    <span className="mono text-xs truncate" style={{ color: 'var(--color-source)' }}>{c.before}</span>
                    <span style={{ color: 'var(--color-faint)' }}>→</span>
                    <span className="mono text-xs truncate" style={{ color: 'var(--color-client)' }}>{c.after}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {feasibility && feasibility.findings.length > 0 && (
            <div className="panel-soft p-3" style={{ borderColor: feasibility.ok ? 'var(--color-line)' : 'color-mix(in srgb, var(--color-danger) 40%, transparent)' }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="label">pre-flight</span>
                <span className={feasibility.ok ? 'chip chip-jade' : 'chip'} style={feasibility.ok ? undefined : { color: 'var(--color-danger)' }}>
                  {feasibility.ok ? 'fits Discord limits' : 'over a hard limit'}
                </span>
              </div>
              <div className="space-y-1">
                {feasibility.findings.map((f, i) => (
                  <div key={i} className="text-[0.74rem] flex gap-2">
                    <span className="mono" style={{ color: f.severity === 'block' ? 'var(--color-danger)' : 'var(--color-gold)', minWidth: 56 }}>
                      {f.severity === 'block' ? '✗ block' : '⚠ warn'}
                    </span>
                    <span style={{ color: 'var(--color-muted)' }}>{f.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="panel p-5">
            <div className="flex items-center gap-3">
              <button className="btn" onClick={() => run(true)} disabled={running}>
                {running ? 'Running…' : '◐ Dry-run'}
              </button>
              <button
                className="btn btn-primary"
                onClick={() => run(false)}
                disabled={running || feasibility?.ok === false}
                title={feasibility?.ok === false ? 'Resolve the pre-flight blocks first' : undefined}
              >
                Build the server →
              </button>
              <div className="ml-auto mono text-xs" style={{ color: 'var(--color-faint)' }}>
                {Math.round(progress * 100)}%
              </div>
            </div>

            {events.length > 0 && (
              <div ref={logRef} className="term mt-4" style={{ maxHeight: 200 }}>
                {events.map((e, i) => (
                  <div key={i} style={{ color: e.type === 'error' ? 'var(--color-danger)' : e.type === 'done' ? 'var(--color-jade)' : 'var(--color-muted)' }}>
                    <span style={{ color: 'var(--color-faint)' }}>{e.type === 'progress' ? '·' : '›'} </span>
                    {e.message ?? (e.step ? `${e.step} ${Math.round((e.progress ?? 0) * 100)}%` : '')}
                  </div>
                ))}
              </div>
            )}
          </div>

          {report && <Report report={report} clientName={targetName} />}
        </section>
      </div>
    </div>
  );
}

function Identity({ tone, label, name }: { tone: 'source' | 'client'; label: string; name: string }) {
  const color = tone === 'source' ? 'var(--color-source)' : 'var(--color-client)';
  return (
    <div className="text-center" style={{ width: 150 }}>
      <div className="eyebrow mb-2">{label}</div>
      <div
        className="panel-soft px-3 py-3"
        style={{ borderColor: `color-mix(in srgb, ${color} 40%, transparent)` }}
      >
        <div className="font-semibold text-sm leading-tight" style={{ fontFamily: 'var(--font-display)', color }}>
          {name}
        </div>
      </div>
    </div>
  );
}

function RowEditor({
  title,
  tone,
  rows,
  setRows,
  placeholder,
  mono,
}: {
  title: string;
  tone: 'name' | 'color' | 'url';
  rows: Row[];
  setRows: (r: Row[]) => void;
  placeholder: string;
  mono?: boolean;
}) {
  const chip = tone === 'color' ? 'chip-client' : tone === 'url' ? 'chip' : 'chip-source';
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1.5">
        <span className="label">{title}</span>
        <span className={cx('chip', chip)}>{rows.length}</span>
      </div>
      <div className="space-y-1.5">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              className={cx('input', mono && 'mono')}
              style={{ fontSize: '0.78rem', color: 'var(--color-faint)' }}
              value={r.from}
              readOnly
            />
            <span style={{ color: 'var(--color-faint)' }}>→</span>
            <input
              className={cx('input', mono && 'mono')}
              style={{ fontSize: '0.78rem' }}
              placeholder={placeholder}
              value={r.to}
              onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))}
            />
          </div>
        ))}
        {rows.length === 0 && <div className="text-xs" style={{ color: 'var(--color-faint)' }}>none detected</div>}
      </div>
    </div>
  );
}

function Report({ report, clientName }: { report: RebuildReport; clientName: string }) {
  return (
    <div className="panel p-5 rise">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="eyebrow mb-1">{report.dryRun ? 'dry-run report' : 'rebuild report'}</div>
          <h2 className="text-lg">
            {report.dryRun ? 'Preview complete' : (
              <>
                {clientName} is <span className="transform-text">ready to hand over</span>
              </>
            )}
          </h2>
        </div>
        {!report.dryRun && <span className="chip chip-jade">● built</span>}
      </div>

      <div className="grid grid-cols-3 gap-2 mb-5">
        <Stat n={report.created.length} label={report.dryRun ? 'would create' : 'created'} tone="jade" />
        <Stat n={report.skipped.length} label="skipped" tone="muted" />
        <Stat n={report.manualSteps.length} label="manual steps" tone="gold" />
      </div>

      {(report.botSetup?.length ?? 0) > 0 && (
        <Block title="Bot setup checklist" hint="re-invite & reconfigure — vendor settings can't be cloned">
          <BotSetupList entries={report.botSetup} />
        </Block>
      )}

      <Block title="Manual steps" hint="surfaced honestly — never silently skipped">
        {report.manualSteps.map((s, i) => (
          <div key={i} className="panel-soft px-3 py-2">
            <div className="text-sm font-medium">{s.title}</div>
            <div className="text-[0.72rem] mt-0.5" style={{ color: 'var(--color-muted)' }}>{s.reason}</div>
          </div>
        ))}
      </Block>

      {report.warnings.length > 0 && (
        <Block title="Warnings">
          {report.warnings.map((w, i) => (
            <div key={i} className="text-[0.78rem]" style={{ color: 'var(--color-gold)' }}>⚠ {w}</div>
          ))}
        </Block>
      )}
    </div>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone: 'jade' | 'gold' | 'muted' }) {
  const color = tone === 'jade' ? 'var(--color-jade)' : tone === 'gold' ? 'var(--color-gold)' : 'var(--color-muted)';
  return (
    <div className="panel-soft px-3 py-3 text-center">
      <div className="text-2xl leading-none" style={{ fontFamily: 'var(--font-display)', color }}>{n}</div>
      <div className="text-[0.62rem] mono mt-1.5" style={{ color: 'var(--color-faint)' }}>{label}</div>
    </div>
  );
}

function Block({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="flex items-baseline gap-2 mb-2">
        <span className="label">{title}</span>
        {hint && <span className="text-[0.68rem]" style={{ color: 'var(--color-faint)' }}>{hint}</span>}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}
