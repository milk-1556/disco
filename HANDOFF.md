<div align="center">

# ⟜→ Disco

### Snapshot a server once. Rebrand and build it a hundred times.

*The assembly line for selling custom-branded Discord communities — $30–60k agency builds, productized.*

</div>

---

## The pitch

You build polished, fully-branded Discord communities for casino & betting creators and sell them as
done-for-you deals: a build fee up front, monthly management after, upsells on top. Today every sale
means rebuilding the whole thing by hand — re-creating every channel, re-applying every permission,
re-skinning every detail. It's slow, it's inconsistent, and it caps how many you can sell.

**Disco turns that craft into a product line.** Capture a finished template once into a portable,
versioned artifact. Rebrand it for a client in a few clicks — names, colors, links, copy, assets.
Build it into a fresh server in dependency-correct order, idempotently, with a dry-run first. Then
hand it over with a branded, client-facing delivery page — and track the revenue, retainer, and
upsells against it.

The unlock is simple: **snapshot once, rebrand-and-build many.** A template stops being a thing you
rebuild and becomes a SKU you sell.

---

## See it

**The library — your product SKUs.** Templates captured once: versioned, searchable, taggable,
favoritable, promotable to master template, exportable as a portable `.discobundle`. Import a *real*
server you've joined (add the bot → copy it into the library) or a demo fixture.

![Snapshot library](docs/screenshots/library.png)

**The build console — the signature.** A source template (violet) transforms into a client identity
(rose) along a live spine whose steps light up as the build runs. Detected brand tokens are pre-filled;
every swap is previewed; a dry-run produces the full report — created, skipped, and the honest manual
steps for everything Discord's API can't clone.

![Build console](docs/screenshots/build-console.png)

**The economics view — the business, not just the build.** Won vs. pipeline, one-time build fees,
recurring MRR/ARR from retainers, upsell revenue, and the per-build compute cost (API calls ×
wall-clock) so you can see how far one month of one retainer covers the cost of the build.

**The delivery page — what the client sees.** Branded with the client's logo and a custom welcome,
optionally password-gated, shareable as a link. The included scope, one-click bot re-invites, and a
walk-through for transferring ownership.

![Public handover page](docs/screenshots/public-handover.png)

**The pulse — the system breathing.** A live feed of every build and capture across the operation.

![Live activity feed](docs/screenshots/activity.png)

---

## What you can do on day one

- **Import** a real server you've joined (`/guilds` lists joined guilds → `/snapshots/capture` with a
  `sourceGuildId` copies it in) — or a demo fixture, with zero token. Re-importing a structurally
  identical server is a no-op (no version bloat).
- **Snapshot** channels, categories, roles, permission overwrites, emojis, stickers, AutoMod, guild
  settings, welcome screen, and the content of *info* channels into a typed, versioned, diffable artifact.
- **Rebrand** deterministically: smart find/replace (camelCase + url-slug aware), color & link maps,
  asset swaps, all previewed before anything is built.
- **Build** into a fresh guild — dependency-ordered, **idempotent** (build twice → no duplicates),
  **resumable** (a crash resumes from the manifest, never re-creates), rate-limit-aware, with a
  **dry-run** mode that writes nothing.
- **Price & track** each deal: build fee + monthly retainer + upsells per client, rolled up into the
  Economics view (won vs. pipeline, MRR/ARR, upsell revenue, compute cost per build).
- **Sell** through a Stripe checkout scaffold: a paid `checkout.session.completed` webhook can
  auto-create the client from session metadata (live webhook verification works today; live session
  *creation* is the one documented TODO — see `docs/stripe-go-live.md`).
- **Deliver** with a Bot Setup Checklist (per-vendor OAuth re-invite URLs + reconfigure steps), an
  Ownership Transfer Checklist, an upsell tracker, and a branded public handover page.
- **Operate at scale**: a build queue with retry/resume/cancel + live logs, per-step timing (your unit
  economics), a pre-flight authority + feasibility check before any live run, snapshot diff, client
  records, and export/import `.discobundle` for off-platform reproducibility.

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

## Architecture (monorepo, pnpm + turbo)

| Workspace | What it is |
| --- | --- |
| `packages/schema` | The spine. Zod schemas for the Snapshot, RebrandConfig, Job/Manifest, RebuildReport. Everything depends on this. |
| `packages/core` | Pure, Discord-free engines: rebrand transform, brand-token extraction, content classification, manifest reconciliation, capture + rebuild engines over `CapturePort`/`ApplyPort`, feasibility/authority audits, bundle export/import. Fully unit-testable, no credentials. |
| `packages/sdk` | The Discord I/O layer: the real **discord.js v14** `DiscordGuildClient` (REST/Routes, rate-limit queue, asset store) **and** the in-memory **MockGuild** that implements the exact same ports — including injected 429/5xx failure modes. `listJoinedGuilds`, `mockGuildFromSnapshot`. |
| `apps/api` | **Fastify** REST + SSE. Auth (JWT + bcrypt), snapshots/clients/jobs/handovers routes, Stripe scaffold. `makeRepo()` picks Postgres (Prisma) when `DATABASE_URL` is set, else in-memory demo. `POST /jobs` enqueues to BullMQ when `REDIS_URL` is set, else runs inline. |
| `apps/worker` | **BullMQ** consumer. Runs the *same* `@disco/core` build engine, checkpoints the manifest (resume-safe), writes results to Postgres before publishing `done`. |
| `apps/web` | **React + Vite + Tailwind v4** dashboard (strict TS). The bespoke "cloning console" design system. Hash-routed screens: Library, Build console, Queue, Clients, Economics, Activity, Setup, Diff, Invite, Handover, + a public delivery page (`#/h/:id`). |
| `apps/landing` | Public marketing page (`index.html`) — the cloning-console identity ported to a sales page. |

Stores: **Postgres** (Prisma; jobs/snapshots/clients/handovers) + **Redis** (BullMQ queue + cross-process
SSE log transport). Both optional — the tokenless/dbless/redisless demo still boots.

## The core flow

**import / snapshot → rebrand → dry-run → build → report → handover**, all runnable end-to-end with
zero Discord token against the MockGuild.

## Run it — one script (recommended)

The verified path on this machine. Needs native **Postgres 16 + Redis** up (`brew services`):

```bash
corepack enable && pnpm install
brew services start postgresql@16 redis
createdb disco                                   # + a 'disco' role (see infra/README)
pnpm --filter @disco/api exec prisma db push     # apply the schema

scripts/serve-test.sh                            # builds web, starts api(:4000)+worker, serves web on :4173
node scripts/seed-demo.mjs                        # curated demo: clients, a real completed build, a handover
```

`serve-test.sh` serves the **production web build** via `vite preview` on **:4173** (proxies `/api` →
:4000), starts the API and worker, and prints `/health`. Logs land in `/tmp/disco-*.log`. Stop with
`scripts/stop-test.sh`. Open <http://localhost:4173> → sign in `operator@disco.local` / `disco`.

To share it over the internet, run a quick tunnel — **`cloudflared` needs an explicit empty config on
this box** or it picks up a stale named-tunnel config:

```bash
cloudflared tunnel --config /dev/null --url http://localhost:4173
```

`stop-test.sh` also kills any `cloudflared tunnel --url` it started.

## Run it — bare minimum (no Postgres, no Redis, no token)

```bash
pnpm --filter @disco/api start      # API :4000, DEMO mode (in-memory repo, inline jobs)
pnpm --filter @disco/web dev        # dashboard :5173 (Vite dev, proxies /api → :4000)
```

Everything runs against the in-memory MockGuild; nothing touches Discord, Postgres, or Redis.

## What's mocked vs. live

- **The engine, rebrand, classification, report, idempotency, economics, and dashboard are the real thing.**
- The only thing mocked in demo mode is the *target of Discord I/O*: import/build run against an
  in-memory **MockGuild** implementing the exact ports the live client implements — and it injects
  Discord's real failure modes (429s with `Retry-After`, transient 5xx) so the engine has weathered
  them before it ever touches a real server.
- The **live discord.js v14 client** (`packages/sdk/src/discord/client.ts`) is written and has automated
  coverage (its REST calls are asserted against the library's own types via a mocked HTTP layer) — it
  just hasn't been pointed at a real token. That first run is yours.
- **Stripe** is in scaffold mode by default: checkout returns a deterministic fake; the webhook accepts
  events unverified so you can test fulfilment locally. Set the keys to go live (webhook verification is
  fully functional; live session *creation* is a documented `501` TODO). See `docs/stripe-go-live.md`.

## First **live** server build — the safe path

> This is the one hard gate. Build against your *own* test guild first, knowingly.

1. **Create the bot** (Discord Developer Portal) and enable the privileged intents the README lists.
2. **Invite it** to the source template and an empty target guild with **Administrator** — use the
   dashboard's **Invite** screen.
3. **Pre-flight:** run the **authority check** (`/preflight/:guildId`) against each guild id — it
   confirms the bot has every permission Disco needs *before* anything is built. The **feasibility**
   check (`/snapshots/:id/feasibility`) confirms the snapshot fits Discord's limits.
4. **Set the token:** `DISCORD_BOT_TOKEN` (+ `DISCORD_APPLICATION_ID`) in `.env`, restart the API
   (`/health` will read `"mode":"live"` and `/guilds` will list the bot's *real* joined servers).
5. **Import** the source server, **dry-run** the rebrand (writes nothing), read the report.
6. **Build** into the *empty test guild*. Then work the Bot Setup Checklist and Manual Steps.
7. Only then repeat against a real client's guild. The terminal `build-guild` CLI also dry-runs by
   default and refuses `--apply` without a real guild + token.

The honesty rule holds throughout: anything Discord can't clone (third-party bot configs, member data,
boost perks, interactive panels, Discovery) is surfaced as a **Manual Step with a reason** — never
silently skipped. See the README's "What Disco cannot do, and why".

## Hard gates (operator decisions, nothing else blocks)

- **No real bot token here** → all Discord I/O verified against the MockGuild + fixtures. The first
  live build against a real guild is **your** trigger, knowingly. (`BLOCKERS.md`)
- **No Docker here** → `infra/docker-compose.yml` (web/api/worker/postgres/redis + a one-shot `migrate`
  service) is authored and config-valid but not booted on this box. The **native** path above is the
  one verified end-to-end. One `docker compose up --build` on a Docker box boots the whole stack.
- **Stripe live checkout-session creation** is a documented `501` TODO — webhook verification + scaffold
  are live now. Flip the keys and wire the SDK call per `docs/stripe-go-live.md` when you're ready to sell.

## Status

- **Engine + SDK + API + worker + dashboard + landing**: complete and tested. ~82 unit tests across 17
  files + 4 integration tests (`apps/api/test/queue.integration.test.ts`, against real Postgres+Redis),
  typecheck clean. The import → rebrand → dry-run → build → report → handover path is proven end-to-end
  and verified to resume idempotently under injected failures.
- **Shipped since the last handoff:** real Discord import flow (`#prod-1`), responsive fixes (`#prod-2`),
  the economics revenue model — builds + retainers + upsells, won vs. pipeline (`#prod-3`), Queue +
  Activity rework (`#prod-4`), post-verify polish (`#prod-5`), the public landing page, and the Stripe
  sales scaffold.
- **The only remaining decision is yours:** the first live build against a real guild (and flipping
  Stripe live when you start charging).

— Built autonomously; every increment typechecked, tested, frame-grabbed, and pushed to `milk-1556/disco`.
The honesty rule is load-bearing: if it can't be cloned, the report says so — out loud, with a reason.
