# Disco — Handoff

Snapshot a finished Discord template server → rebrand it for a client → rebuild it into a fresh
guild → deliver it. **Snapshot once, rebrand-and-build many.**

This document is the operator's starting point: what's built, how to run it, what's proven vs.
mocked, and exactly how to do the first **live** server build safely.

---

## TL;DR — run it in 2 minutes (no Discord token needed)

```bash
corepack enable
pnpm install
pnpm --filter @disco/api start      # API on :4000 (DEMO mode, in-memory)
pnpm --filter @disco/web dev        # dashboard on :5173 (proxies /api → :4000)
```

Open http://localhost:5173 → sign in `operator@disco.local` / `disco` → open the seeded
**Acme Slots HQ** template → **Rebrand & build** → edit the swaps → **Dry-run** → read the report.
Everything runs against an in-memory mock guild; nothing touches Discord.

Or the whole stack at once: `docker compose -f infra/docker-compose.yml up --build` (adds Postgres + Redis + worker).

---

## What's built (and verified)

| Package | What it is | Verified by |
| --- | --- | --- |
| `@disco/schema` | The typed spine — zod schemas for Snapshot, RebrandConfig, Client, Job/Manifest/Report. localRefs everywhere (never raw Discord ids) → portable, idempotent. | typecheck + 4 unit tests |
| `@disco/core` | All pure engines: **rebrand** transform (smart find/replace + color/link maps), brand-token extraction, channel classification, **capture**, **rebuild** (dependency-ordered, idempotent, resumable, dry-run), manifest reconciliation, plan/report. | typecheck + 22 unit tests |
| `@disco/sdk` | Ports + an in-memory **MockGuild** (both ports) + the **live discord.js v14 client** (REST over discord.js's rate-limit queue) + asset storage. | typecheck (vs discord.js types) + 4 **integration** tests |
| `@disco/api` | Fastify REST + JWT/bcrypt auth + SSE job logs + invite generator. In-memory `Repo` (Prisma drop-in). | **booted + curl'd** end to end |
| `@disco/worker` | BullMQ build worker — runs the same engine off a Redis queue. | typecheck |
| `@disco/web` | The premium "cloning console" dashboard (Vite/React/Tailwind). | **booted + screenshot-verified** end to end |

**Proven end-to-end** (zero credentials): capture a source guild → rebrand → **dry-run** →
**build into a fresh guild** → report → re-capture and assert the rebrand landed; managed roles
skipped, member overwrites skipped, content copied via webhook, and **building twice never
duplicates** (idempotency). See `packages/sdk/test/integration.test.ts`.

Run it all: `pnpm typecheck && pnpm test` → 30 tests pass, 9 tasks typecheck clean.

## What's mocked vs. live

- **Mocked now:** the *target of Discord I/O*. In demo mode capture/build run against `MockGuild`,
  an in-memory guild implementing the exact same ports the real client implements. The engines,
  rebrand, classification, report, idempotency, and dashboard are all the real thing.
- **Live, but not yet run:** `DiscordGuildClient` (the real discord.js v14 client) is written and
  typechecks against discord.js's own types — so the REST routes/signatures are real, not invented —
  but it has not been pointed at a live token. That first run is your call (see below).
- **Honest by design:** anything Discord's API genuinely cannot clone (third-party bot configs,
  member data, boost perks, interactive panels, Discovery) is surfaced as a **Manual Step with a
  reason** in the report — never silently skipped. See the README's "What Disco cannot do and why".

## First **live** server build — the safe path

> This is the one hard gate. Build against your *own* test guild first, knowingly.

1. **Create the bot** at https://discord.com/developers/applications → Bot. Enable the privileged
   intents listed in the README (Server Members, Message Content, plus Guilds / Expressions /
   Webhooks / AutoMod). Copy the token.
2. **Invite it** to both the source template guild and an empty target guild with **Administrator** —
   use the dashboard's **Invite** screen to generate the exact OAuth URL (or `GET /invite-url`).
3. **Set the token:** put `DISCORD_BOT_TOKEN` and `DISCORD_APPLICATION_ID` in `.env`, restart the API.
   `GET /health` will report `"mode":"live"`.
4. **Capture** the source: `POST /snapshots/capture { "sourceGuildId": "<template guild id>" }`
   (or the Library's "New snapshot"). Review it in the Library.
5. **Dry-run first.** In the Build console, set the rebrand and click **Dry-run** — read the report
   and Manual Steps. Nothing is written to Discord.
6. **Build** into the *empty test guild*: the live `DiscordGuildClient` is constructed for the
   target guild id, and the same engine runs — now writing real channels/roles/etc.
7. **Verify**, then work the **Bot Setup Checklist** (re-invite MEE6/Whop/etc.) and the report's
   Manual Steps. Only then repeat against a real client's guild.

Do **not** point a first live build at a production guild you were handed "for later."

## Production wire-up — DONE (was "remaining"; now built & verified)

1. **Persistence:** `PrismaRepo` (`apps/api/src/prismaRepo.ts`) sits behind the async `Repo` interface;
   `makeRepo()` selects Postgres when `DATABASE_URL` is set, else the zero-setup in-memory demo. Json
   columns are re-validated through zod on read (tolerant `safeParse` so a legacy row can't 500 a list).
2. **Queue:** `POST /jobs` enqueues to the BullMQ `disco-builds` queue when `REDIS_URL` is set; the
   `@disco/worker` consumes it, runs the SAME `runBuildJob`, resumes from the persisted manifest (so a
   retry never duplicates), and writes results to Postgres BEFORE publishing `done`. SSE logs are
   cross-process + durable (Redis pub/sub + LIST replay, gap-free via INCR seq + RPUSH-before-PUBLISH),
   with a terminal short-circuit. Without `REDIS_URL` the API runs builds in-process — identical code.
3. **Dashboard:** snapshot **diff view**, **New Client** intake + Clients list, and the **Handover page**
   (included scope + Bot Setup Checklist + Ownership Transfer Checklist + upsell tracker) are all built.

**Verified on this box** against native Postgres 16 + Redis (installed via brew, since no Docker here):
`apps/api` `test:integration` is 3/3 (enqueue → worker → Postgres → API read-back, cross-process SSE,
terminal short-circuit), plus a manual two-process run and in-browser screenshots of every screen.
The wiring was pressure-tested by a design workflow up front and an 8-finding adversarial-review
workflow after — all confirmed findings fixed (see git log).

### Run the production stack locally (no Docker needed)
```bash
brew services start postgresql@16 redis      # or use your own PG/Redis
createdb disco                               # + a 'disco' role, see infra/README
export DATABASE_URL=postgresql://disco:disco@localhost:5432/disco?schema=public REDIS_URL=redis://localhost:6379
pnpm --filter @disco/api exec prisma db push # apply the schema
pnpm --filter @disco/api start   &           # :4000  (postgres · redis-queue)
pnpm --filter @disco/worker start &          # consumes the queue
pnpm --filter @disco/web dev                 # :5173
```

See `PROGRESS.md` for unit-by-unit status and `BLOCKERS.md` for the one real gate (a live bot token)
plus the Docker note.

## Environment notes from the build machine

- `docker` was not installed here, so `docker compose up` is authored and config-valid but was not
  booted on this box. The Node path (above) was booted and verified.
- No bot token was provided, so all Discord I/O was verified against MockGuild + fixtures.

— Built autonomously; every increment typechecked, tested, and pushed to `milk-1556/disco`.
