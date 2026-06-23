# Disco

**Snapshot a finished Discord template server → rebrand it for a client → rebuild it into a fresh
guild → deliver it.** Disco turns a hand-built, re-do-it-every-time workflow into an assembly line:
**snapshot once, rebrand-and-build many.**

> Status: under active construction. See [`PROGRESS.md`](./PROGRESS.md) for the live build state and
> [`BLOCKERS.md`](./BLOCKERS.md) (if present) for anything awaiting an operator decision.

## What it does

1. **Snapshot** — capture a guild's *clonable* state (channels, categories, roles, permission
   overwrites, emojis, stickers, AutoMod rules, guild settings, welcome screen, and the content of
   *system/info* channels) into a typed, versioned JSON artifact. Snapshots are listed, named,
   versioned, and **diffable**.
2. **Rebrand** — a deterministic transform `Snapshot + RebrandConfig → RebrandedSnapshot`: find/replace
   names & copy, remap colors and links, swap assets — all previewed before anything is built.
3. **Rebuild** — apply the rebranded snapshot to a fresh target guild in **dependency-correct order**,
   **idempotently** and **resumably**, with a **dry-run** mode and rate-limit-aware progress.
4. **Deliver** — a per-client Handover page, Bot Setup Checklist, and Ownership Transfer Checklist.

## Monorepo layout

```
apps/
  api       Fastify REST API + job orchestration + SSE job logs
  worker    BullMQ worker(s) — runs snapshots & builds resumably off Redis
  bot       discord.js v14 gateway client (shared)
  web       React + Vite + Tailwind dashboard (stepper-driven)
packages/
  schema    zod schemas + shared types — Snapshot, RebrandConfig, Job, Manifest  (the spine)
  core      pure engines: snapshot / rebrand / rebuild / botDetect / classify / manifest
  sdk       typed wrapper around Discord REST/gateway (+ a MockGuild for tests)
infra/      docker-compose, .env.example, ops notes
```

## Quickstart (5 minutes)

```bash
corepack enable                 # provides pnpm
pnpm install
cp .env.example .env            # fill in DISCORD_BOT_TOKEN etc. when doing live runs
pnpm typecheck && pnpm test     # the pure core verifies with zero Discord access
docker compose -f infra/docker-compose.yml up   # api + worker + web + postgres + redis
```

The pure core (`@disco/schema`, `@disco/core`) builds and tests **without any Discord credentials**.
Discord I/O runs against an in-memory **MockGuild** until you knowingly trigger a real-server run.

## Bot permissions & privileged intents

Disco's bot needs **Administrator** in both the source (template) and target (client) guilds, plus
these privileged intents (enable them in the Discord Developer Portal → your app → Bot):

| Intent | Why |
| --- | --- |
| Guilds | enumerate channels/roles/settings |
| Server Members | enumerate bot members for detection |
| Message Content | read system/info channel content to copy |
| Guild Expressions | read & re-upload emojis/stickers |
| Guild Webhooks | re-post copied content under a controllable identity |
| AutoMod Configuration | read & recreate AutoMod rules |

The dashboard's **invite-link generator** builds the exact OAuth URL with the correct permission
integer for adding Disco to a guild.

## What Disco CANNOT do, and why (read this)

Disco never fakes a capability. These items are **impossible via any bot API** and are surfaced as
**guided manual steps** in the Rebuild Report, never silently skipped:

- **Third-party bots (MEE6, Carl-bot, Dyno, Whop, Tickets, …).** A bot's configuration lives on the
  *vendor's* servers, not in your guild — no API can copy it. Disco *detects* every bot, records its
  name/ID/recognized vendor, scrapes any *readable* traces (permission overwrites it set, webhooks it
  created, AutoMod it owns), and emits a **Bot Setup Checklist** with invite/OAuth links and a
  per-bot "what to reconfigure" note. You re-invite and configure.
- **Member-specific data** — member→role assignments, the member list, boosts/boost-locked perks
  (unless the target already has the boost tier), vanity URL, audit-log history.
- **Member chat content.** Disco copies **system/info channels only** (rules, welcome, info, links,
  role-select…), default-gated with a per-channel operator toggle. Member conversation is never copied.
- **A bot's live behavior** — slash commands, internal logic, dynamically generated embeds. A
  *rendered* embed that still exists as a message can be copied; the bot that produced it cannot.
- **Reaction-role / button-role / ticket panels** copy *visually* but won't function until the owning
  bot is reconfigured — every such channel is flagged in the report.
- **Discovery / Monetization** and other features gated behind Discord review.

## License

Private / internal. Not for redistribution.
