<div align="center">

# ⟜→ Disco

### Snapshot a server once. Rebrand and build it a hundred times.

*The assembly line for selling custom-branded Discord communities.*

</div>

---

## The pitch

You build polished, fully-branded Discord communities and sell them to creators. Today every sale
means rebuilding the whole thing by hand — re-creating every channel, re-applying every permission,
re-skinning every detail. It's slow, it's inconsistent, and it caps how many you can sell.

**Disco turns that craft into a product line.** Capture a finished template once into a portable,
versioned artifact. Rebrand it for a client in a few clicks — names, colors, links, copy, assets.
Build it into a fresh server in dependency-correct order, idempotently, with a dry-run first. Then
hand it over with a branded, client-facing delivery page.

The unlock is simple: **snapshot once, rebrand-and-build many.** A template stops being a thing you
rebuild and becomes a SKU you sell.

---

## See it

**The library — your product SKUs.** Templates captured once: versioned, searchable, taggable,
favoritable, promotable to master template, exportable as a portable bundle.

![Snapshot library](docs/screenshots/library.png)

**The build console — the signature.** A source template (violet) transforms into a client identity
(rose) along a live spine whose steps light up as the build runs. Detected brand tokens are pre-filled;
every swap is previewed; a dry-run produces the full report — created, skipped, and the honest manual
steps for everything Discord's API can't clone.

![Build console](docs/screenshots/build-console.png)

**The delivery page — what the client sees.** Branded with the client's logo and a custom welcome,
optionally password-gated, shareable as a link. The included scope, one-click bot re-invites, and a
walk-through for transferring ownership.

![Public handover page](docs/screenshots/public-handover.png)

**The pulse — the system breathing.** A live feed of every build and capture across the operation.

![Live activity feed](docs/screenshots/activity.png)

---

## What you can do on day one

- **Snapshot** any finished server — channels, categories, roles, permission overwrites, emojis,
  stickers, AutoMod, guild settings, welcome screen, and the content of *info* channels — into a
  typed, versioned, diffable artifact.
- **Rebrand** deterministically: smart find/replace (camelCase + url-slug aware), color & link maps,
  asset swaps, all previewed before anything is built.
- **Build** into a fresh guild — dependency-ordered, **idempotent** (build twice → no duplicates),
  **resumable** (a crash resumes from the manifest, never re-creates), rate-limit-aware, with a
  **dry-run** mode that writes nothing.
- **Deliver** with a Bot Setup Checklist (per-vendor OAuth re-invite URLs + reconfigure steps), an
  Ownership Transfer Checklist, an upsell tracker, and a branded public handover page.
- **Operate at scale**: a build queue with retry/resume/cancel + live logs, per-step timing (your
  unit economics), a pre-flight authority check before any live run, snapshot diff, client records,
  and an export/import `.discobundle` for off-platform reproducibility.

## Why it's worth what you charge

- **Consistency.** Every build is the same artifact applied the same way — no drift, no forgotten
  permission, no "I'll fix it later."
- **Speed → volume.** Minutes per rebuild instead of hours. The same template sells again and again.
- **Trust.** Dry-run before you commit. A pre-flight check that the bot can actually do the job. A
  manifest that resumes instead of duplicating. Honest manual steps for what genuinely can't be
  cloned — never a silent half-build.
- **The handoff sells the next one.** A polished, branded delivery page makes "pay and I hand you a
  ready-to-run community" feel exactly that premium.

> ### What clients say
> *“________________________________________________”*
> — _add a testimonial here after your first delivery_

---

# Operator guide

## Run it (2 minutes, no Discord token)

```bash
corepack enable
pnpm install
pnpm --filter @disco/api start      # API on :4000 (DEMO mode, in-memory)
pnpm --filter @disco/web dev        # dashboard on :5173 (proxies /api → :4000)
```

Open http://localhost:5173 → sign in `operator@disco.local` / `disco` → open the seeded
**Acme Slots HQ** template → **Rebrand & build** → edit the swaps → **Dry-run** → read the report.
Everything runs against an in-memory mock guild; nothing touches Discord.

### Full production stack

```bash
docker compose -f infra/docker-compose.yml up --build      # web · api · worker · postgres · redis
```

Or natively (the path verified on the build machine — no Docker required):

```bash
brew services start postgresql@16 redis
createdb disco                                              # + a 'disco' role (see infra/README)
export DATABASE_URL=postgresql://disco:disco@localhost:5432/disco?schema=public REDIS_URL=redis://localhost:6379
pnpm --filter @disco/api exec prisma db push
pnpm --filter @disco/api start &     pnpm --filter @disco/worker start &     pnpm --filter @disco/web dev
```

In Postgres+Redis mode, `POST /jobs` enqueues to BullMQ, a separate worker runs the build and writes
results to Postgres, and logs stream cross-process over Redis — proven by the integration test
(`pnpm --filter @disco/api test:integration`, 3/3 against real Postgres+Redis).

## What's mocked vs. live

- **The engine, rebrand, classification, report, idempotency, and dashboard are the real thing.**
- The only thing mocked in demo mode is the *target of Discord I/O*: capture/build run against an
  in-memory **MockGuild** that implements the exact same ports the live client implements — and even
  injects Discord's real failure modes (429s with `Retry-After`, transient 5xx) so the engine has
  weathered them before it ever touches a real server.
- The **live discord.js v14 client** is written and has automated coverage (its REST calls are
  asserted against the library's own types via a mocked HTTP layer) — it just hasn't been pointed at
  a real token. That first run is yours.

## First **live** server build — the safe path

> This is the one hard gate. Build against your *own* test guild first, knowingly.

1. **Create the bot** (Discord Developer Portal) and enable the privileged intents the README lists.
2. **Invite it** to the source template and an empty target guild with **Administrator** — use the
   dashboard's **Invite** screen.
3. **Pre-flight:** on the Invite screen, run the **authority check** against each guild id — it
   confirms the bot has every permission Disco needs *before* anything is built.
4. **Set the token:** `DISCORD_BOT_TOKEN` (+ `DISCORD_APPLICATION_ID`) in `.env`, restart the API
   (`/health` will read `"mode":"live"`).
5. **Capture** the source, **dry-run** the rebrand (writes nothing), read the report.
6. **Build** into the *empty test guild*. Then work the Bot Setup Checklist and Manual Steps.
7. Only then repeat against a real client's guild. The terminal `build-guild` CLI also dry-runs by
   default and refuses `--apply` without a real guild + token.

The honesty rule holds throughout: anything Discord can't clone (third-party bot configs, member
data, boost perks, interactive panels, Discovery) is surfaced as a **Manual Step with a reason** —
never silently skipped. See the README's "What Disco cannot do and why".

## Status

- **Engine + SDK + API + worker + dashboard**: complete and tested. ~55 unit tests + 3 integration
  tests (real Postgres+Redis), 9 typecheck tasks clean. The snapshot→rebrand→dry-run→build→report
  path is proven end-to-end, and verified to resume idempotently under injected failures.
- **Gates (build machine):** no Docker here (compose authored + config-valid; the native path is the
  one verified). No bot token — all Discord I/O verified against the MockGuild + a mocked live client.
- **The only remaining decision is yours:** the first live build against a real guild.

— Built autonomously; every increment typechecked, tested, frame-grabbed, and pushed to `milk-1556/disco`.
