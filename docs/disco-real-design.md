# Disco — the real design (Max-only Discord server templating + deployment tool)

_The target the re-scope aims at. Disco is Max's internal tool: it maintains curated Discord server
**templates** and uses the **Discord Bot API** to deploy them as real servers for the creators Max serves,
keep those servers updated from the template, and back up existing servers into templates._

## Mission, in one line

Pick a **template** → set a creator's **variables** → **deploy** it as a real Discord server → later **push
updates** to that live server, or **back up** any live server into a new template.

## Data model (re-scoped)

- **Template** — first-class (not a boolean on a snapshot). `{ id, name, note, structure: Snapshot,
  version, createdFrom: 'blank'|'captured', capturedGuildId?, updatedAt }`. The `Snapshot` artifact (roles,
  channels, categories, permission overwrites, emojis, stickers, automod, welcome screen, info-channel
  content, bots-detected) stays exactly as-is — it's the correct portable spine (localRefs, never raw ids).
- **Creator** — lean per-creator record: `{ id, name, handle, brandColors, links, termSwaps, assets }`.
  Drop the CRM/economics fields (buildPrice, monthlyRetainer, upsells, stripeSessionId, ownerEmail).
- **DeployedServer** _(new)_ — the missing link: `{ id, creatorId, guildId, templateId, templateVersion,
  deployedAt, idMap: localRef→liveId }`. One creator → many deployed servers; the `idMap` is what makes
  "push an update to this live server" possible.
- **Deploy job** — the existing `Job`/manifest/`RebuildReport` machinery (dependency-ordered, resumable),
  minus the invoicing/owner-scoping columns.

## The four operations

1. **Deploy** (exists — keep). Pick a template → set creator variables (`rebrand`: name/find-replace/colors/
   links/assets, previewed) → `rebuildGuild` writes the whole structure into the target guild via the Bot
   API, dependency-ordered, idempotent, dry-run-first. On success, record a **DeployedServer** row with the
   `localRef→liveId` map. Prereq: the guild exists and the bot is invited (Invite screen builds the OAuth
   URL); a pre-flight authority + limits check runs first.
2. **Update / push-diff to a live server** (**build this** — mission gap c, destructive). Given a
   DeployedServer: capture its *current* live state, diff it against the *current* template, compute a delta
   (create new · edit changed-in-place · **remove** dropped), show Max the plan, and apply only on explicit
   confirm. Requires new **delete methods** on `ApplyPort`/`DiscordGuildClient` (deleteRole/deleteChannel/
   deleteEmoji/…) and a rename-vs-remove heuristic driven by the persisted `idMap` (not fragile name-match).
   Adversarially reviewed; tested against a throwaway guild; **inert-by-default** (no live mutation without a
   token + an explicit Max confirm).
3. **Back up / capture a live server → template** (exists — keep, surface better). `captureSnapshot` already
   reads any guild the bot is in into a template artifact. Add: "capture this DeployedServer back into its
   template line" (re-version) and "capture any guild as a new template."
4. **Manage** — a per-creator view of their deployed servers (which template+version each runs), the template
   library, and deploy history.

## Auth & access

**Max only.** Keep the single env-admin JWT login (`OPERATOR_EMAIL` + `OPERATOR_PASSWORD_HASH`,
`SESSION_SECRET` boot-guard). Remove the DB-operator table, `/operators`, roles/admin gate, and the
`ownerEmail` owner-scoping wrapper (inert for one user — dead complexity). No public signup, no multi-tenant.

## Discord API prerequisites

- **Bot token** (`DISCORD_BOT_TOKEN`) + application id. The bot is invited to each target guild via the
  Invite screen's OAuth URL. Scopes/permissions: `bot` + `applications.commands`; permission integer covers
  Manage Channels / Manage Roles / Manage Server (AutoMod) / Manage Webhooks / Manage Expressions / Manage
  Messages / Read Message History / View Channels (see `authority.ts:REQUIRED_PERMISSIONS`), or Administrator.
- **Rate limits + retry** — handled by `resilience.ts` (429 Retry-After + exponential 5xx backoff, fail-loud
  on 401/dead token). Deletes (op 2) go through the same wrapper.
- **Guild creation** — out of scope for now: Max pre-creates each guild and invites the bot (the Bot API can
  `POST /guilds` only while in <10 guilds — a possible future convenience, not required).

## UI (re-scoped, mobile-375 primary, dark, restrained)

- **Today** — builds in flight, servers needing an update (template drifted from live), stale templates.
  Drop the deal/revenue/pipeline buckets.
- **Templates** (was Library) — the template library + "capture a server as a template"; drop the marketplace.
- **Deploy** (was Build) — the pick-template → set-variables → preview → deploy wizard.
- **Servers** _(new)_ — per creator, their deployed guilds; per server: "update from template" (op 2) and
  "re-capture."
- **Queue / Activity / Status** — keep (deploy monitoring, live logs, health); drop the webhook-log panel.
- **Invite** — keep (bot OAuth + preflight — essential deploy prereq).
- **Remove** — Economics, Marketplace, Preferences→team, the public client-delivery microsite (keep its
  bot-setup + ownership-transfer report as an *internal* per-deploy ops view).

## What stays exactly as-is

The engine: `capture` → `rebrand` → `reconcile`/`manifest` → `rebuildGuild`, the live `DiscordGuildClient`,
`authority`/`limits` pre-flight, `resilience` retry, dry-run, crash-resume, the honest manual-steps report.
That's the real asset — everything else re-scopes around it.
