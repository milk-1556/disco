// Curated demo data for a clean test drive. Idempotent-ish: run against a freshly-seeded DB
// (2 templates already present). Creates clients, a real completed build (→ metrics/economics/
// activity), a dry-run, and a branded handover. Usage: node scripts/seed-demo.mjs
const BASE = process.env.DISCO_API ?? 'http://localhost:4000';
const login = async () => {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'operator@disco.local', password: 'disco' }),
  });
  if (!r.ok) throw new Error(`login ${r.status}`);
  return (await r.json()).token;
};

const main = async () => {
  const token = await login();
  const H = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
  const get = async (p) => (await fetch(`${BASE}${p}`, { headers: H })).json();
  const post = async (p, body) => {
    const r = await fetch(`${BASE}${p}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`POST ${p} → ${r.status} ${await r.text()}`);
    return r.json();
  };

  const snaps = await get('/snapshots');
  const stakehaus = snaps.find((s) => /stakehaus/i.test(s.name));
  const acme = snaps.find((s) => /acme/i.test(s.name));
  if (!stakehaus) throw new Error('Stakehaus template not found — reseed the DB first.');

  // Clients (creators buying a branded community).
  const aurora = await post('/clients', {
    creatorName: 'Aurora Bets',
    handle: '@aurorabets',
    brandColors: ['#f43f5e', '#fb7185'],
    links: ['https://whop.com/aurorabets'],
    notes: 'High-roller slots community. Wants the Stakehaus layout in rose.',
    buildPrice: 5000,
    monthlyRetainer: 800,
    upsells: [{ name: 'Custom emoji + sticker pack', price: 500 }],
  });
  await post('/clients', {
    creatorName: 'NeonPlay',
    handle: '@neonplay',
    brandColors: ['#22d3ee', '#a855f7'],
    links: ['https://whop.com/neonplay'],
    notes: 'Lead — quoted $4,500 build + management, awaiting deposit.',
    buildPrice: 4500,
    monthlyRetainer: 750,
    upsells: [{ name: 'Full server management', price: 0 }],
  });

  // Real build: Stakehaus → Aurora Bets (rose). Populates metrics, activity, queue, handover.
  const auroraConfig = {
    clientId: aurora.id,
    serverName: 'Aurora Bets HQ',
    findReplace: [{ from: 'Stakehaus', to: 'Aurora Bets', caseInsensitive: true, wholeWordSmart: true }],
    colorMap: [{ from: '#6d28d9', to: '#f43f5e' }],
    linkMap: [{ from: 'https://whop.com/stakehaus', to: 'https://whop.com/aurorabets' }],
    assets: {},
  };
  const realJob = await post('/jobs', { snapshotId: stakehaus.id, clientId: aurora.id, config: auroraConfig, dryRun: false });

  // Poll to completion (worker processes via BullMQ).
  const waitDone = async (id, label) => {
    for (let i = 0; i < 60; i++) {
      const j = await get(`/jobs/${id}`);
      if (j.status === 'completed') return j;
      if (j.status === 'failed') throw new Error(`${label} failed: ${j.error}`);
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`${label} timed out`);
  };
  const done = await waitDone(realJob.id, 'real build');
  console.log(`real build done: ${done.metrics?.apiCalls} API calls, ${done.metrics?.durationMs}ms, ${done.metrics?.objectsCreated} objects`);

  // A dry-run on the Acme template, for queue/preview variety.
  if (acme) {
    const dry = await post('/jobs', {
      snapshotId: acme.id,
      config: { clientId: aurora.id, serverName: 'NeonPlay Lounge', findReplace: [{ from: 'Acme', to: 'NeonPlay', caseInsensitive: true, wholeWordSmart: true }], colorMap: [], linkMap: [], assets: {} },
      dryRun: true,
    });
    await waitDone(dry.id, 'dry run');
  }

  // Branded handover off the real build → populates the delivery page.
  const handover = await post('/handovers', { jobId: realJob.id });
  await fetch(`${BASE}/handovers/${handover.id}`, {
    method: 'PATCH',
    headers: H,
    body: JSON.stringify({
      state: 'ready',
      welcomeMessage: 'Welcome to Aurora Bets HQ — your fully-branded community is live. Follow the steps below to take ownership.',
    }),
  });

  console.log('\nSeed complete:');
  console.log('  clients:', (await get('/clients')).map((c) => c.creatorName).join(', '));
  console.log('  jobs:', (await get('/jobs')).map((j) => `${j.status}/${j.dryRun ? 'dry' : 'live'}`).join(', '));
  console.log('  handover:', handover.id, '→ public page at  #/h/' + handover.id);
};

main().catch((e) => {
  console.error('SEED FAILED:', e.message);
  process.exit(1);
});
