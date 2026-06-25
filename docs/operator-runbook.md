# Operator Go-Live Runbook — Your First Real Discord Build

This is the checklist for taking Disco from demo mode to a **real, deliverable build into a client's Discord server** for the first time. Follow it top to bottom. Every step has a concrete check you can verify in the UI or the API.

> **Hard gate, read this first.** Nothing in Disco mutates a real Discord guild on its own. Capture, readiness, dry-run, and canary all write *nothing* to the client's server. The first real build is **your deliberate trigger** — the moment you uncheck *Canary*, point at the client guild, and click **Build the server →**. Until you do that, you are always safe.

---

## 1. Prerequisites

Before you touch the app, get these in hand:

- [ ] **A Discord bot token.** Create an application at the Discord Developer Portal, add a Bot, and copy its token. This is the `DISCORD_BOT_TOKEN`. Also grab the **Application ID** (`DISCORD_APPLICATION_ID`) — it's what generates the invite URL.
- [ ] **Bot permissions / scopes.** Disco invites with the `bot` scope. The cleanest path is **Administrator** (the in-app invite generator recommends this — "Administrator grants everything a clean clone needs in one invite"). If the client won't grant Administrator, Disco can request granular perms instead, but a build may stop at a Manual Step where a permission is missing. The granular set Disco actually needs (from `packages/core/src/authority.ts`, `REQUIRED_PERMISSIONS`):
  - [ ] **View Channels** — enumerate the structure
  - [ ] **Manage Channels** — create channels & categories
  - [ ] **Manage Roles** — create roles & set overwrites
  - [ ] **Manage Server** — guild settings + AutoMod
  - [ ] **Manage Webhooks** — copy info-channel content
  - [ ] **Manage Expressions** — re-upload emojis & stickers
  - [ ] **Manage Messages** — re-pin copied messages
  - [ ] **Read Message History** — read info-channel content
- [ ] **2FA on the bot's account/server.** Managing roles and server settings via the API requires the guild owner to have 2FA enabled. Turn it on before the build, or role/server writes will be rejected.
- [ ] **A test guild.** Create a throwaway Discord server you own and invite the bot into it. This is where the **canary** build lands so you can inspect a real clone before the client ever sees one. Keep its **Guild ID** handy.

---

## 2. Configure (`.env`)

Disco boots in zero-config demo mode (tokenless, in-memory mock guild). Going live means setting real env vars. **Secrets are yours to type — Disco never generates or stores them for you.** Variables live in `apps/api/src/env.ts`:

- [ ] **`DISCORD_BOT_TOKEN`** — the live bot token. Setting this is what flips Disco from demo → **live mode** (`isLiveMode()` is true the moment the token is non-empty).
- [ ] **`DISCORD_APPLICATION_ID`** — powers the invite-URL generator on the Invite screen.
- [ ] **`SESSION_SECRET`** — **mandatory boot-guard.** Disco *refuses to boot* a production-shaped deploy (live token, Postgres, or `NODE_ENV=production`) on the public dev default secret — otherwise anyone could forge an operator JWT and bypass auth. Generate a strong one:
  ```
  openssl rand -base64 48
  ```
  Use 32+ chars (a shorter value boots with a warning; the dev default is refused outright).
- [ ] **`OPERATOR_EMAIL`** — your operator login identity (defaults to `operator@disco.local`).
- [ ] **`OPERATOR_PASSWORD_HASH`** — bcrypt hash of your operator password. When empty, dev login accepts password `disco` — **set a real hash before going live.**
- [ ] **`DATABASE_URL`** *(optional but recommended for real work)* — a Postgres URL switches Disco from the in-memory demo store to durable PrismaRepo persistence. Setting it also arms the `SESSION_SECRET` boot-guard.
- [ ] **`REDIS_URL`** *(optional)* — when set, builds enqueue to BullMQ and logs stream cross-process over Redis. Without it, builds run in-process (fine for a single-box first launch).
- [ ] **`STORAGE_DISK_PATH`** — where snapshot assets land on disk (defaults to `./storage`).

Restart the API after editing `.env`. If it refuses to boot, read the error — it's almost always the `SESSION_SECRET` guard telling you to set a real secret.

---

## 3. Pre-flight (everything below writes nothing to a real guild)

Work through these in order. Each one is a gate; don't move on until it's green.

- [ ] **Snapshot the source template.** Capture the source/template guild so you have something to clone (`POST /snapshots/capture`; it shows up in your snapshot list with a `sourceGuildId`). This reads the source — it doesn't touch any target.
- [ ] **Readiness check → green.** In the **Build console**, pick the snapshot, set the **target boost tier** (0 = a fresh, unboosted guild — the safe default), and click **🔍 Readiness check**. This runs `POST /builds/readiness`: a synchronous, zero-write full simulation of the build against Discord's hard limits + boost-tier cross-check. It returns one verdict:
  - **`ready`** — go.
  - **`ready_with_warnings`** — boost-locked items (emojis/stickers over slot count, server banner, invite splash, role icons, gradient role colors) will skip cleanly and land on the handover punch-list. You can **Build anyway** (they skip) or **boost the guild first** and they'll all apply.
  - **`blocked`** — a hard limit would be exceeded (over 250 roles or 500 channels+categories). Fix the snapshot before building; this one is a real stop.
  - The panel also shows `wouldCreate` / `wouldSkip` / manual-step counts and the target tier.
- [ ] **/preflight authority audit.** On the **Invite** screen, under *Pre-flight authority check*, paste the **guild ID** and run it (`GET /preflight/:guildId`). This checks the bot's *effective* permissions in that specific guild against `REQUIRED_PERMISSIONS`:
  - ✓ *Ready* — the bot has Administrator (or every permission Disco needs).
  - ✗ *Not ready* — it names exactly which permissions are missing. **Re-invite with the right perms first** (toggle them on the bot's role page — the invite link alone can't flip already-granted ones).
  - Run this against your **test guild** now, and again against the **client guild** in step 4.
- [ ] **Boost-tier pre-flight.** The Build console shows a feasibility panel for the target tier you selected (`auditBuildLimits`). Confirm everything either fits the tier or you've accepted that boost-locked items will skip. Source template captured from a higher-boost guild than the target? It'll nudge you to boost the target to match.
- [ ] **Canary into your TEST guild.** Tick **"Canary — build into a test guild first"**, paste your **test guild ID**, and click **Build canary →**. This builds a *real* server into your test guild so you can inspect it with your own eyes — **no client handover is created** (`Job.canary`; the API blocks delivering a canary: rebuild without canary to hand it to a client).
  - *(Optional drier check: **◐ Dry-run** walks the entire build with zero Discord writes and prints the report. Use it for a fast projection without spinning up a real test server.)*
- [ ] **Inspect the canary.** Open your test guild in Discord. Walk the categories, channels, roles, overwrites, emojis, pins. Cross-check the report's "would create / skipped / manual steps". Only when the canary looks right do you proceed.

---

## 4. First Real Build — the deliberate trigger

This is the hard gate. Everything above wrote nothing to the client's server. This step does.

- [ ] **Re-run the authority audit against the CLIENT guild** (step 3's /preflight) and confirm ✓ Ready.
- [ ] **Confirm the target.** In the Build console, **uncheck Canary**. The primary button flips from "Build canary →" to **Build the server →**. Make sure you're pointed at the **client guild**, with the snapshot and target tier you validated.
- [ ] **Trigger it.** Click **Build the server →**. The job enqueues (BullMQ if `REDIS_URL` is set, else in-process) and starts running.
- [ ] **Watch the queue + logs.** The console streams live logs over SSE; the **Queue** screen shows the job status (`running` → `completed` / `failed`). A running job cannot be interrupted — let it finish.
- [ ] **Read the rebuild report.** On completion you get a real build report (not a dry-run): created objects, skipped (boost-locked) items, and the manual-steps punch-list the client will need to finish by hand.

---

## 5. Deliver — handover

Turn the finished build into a client-facing delivery page.

- [ ] **Create the handover.** From the completed job, create a handover (`POST /handovers`, idempotent per job). It starts in state **`draft`** — work-in-progress, and **the public link 404s while it's a draft** so no half-finished scope ever leaks.
- [ ] **Polish the draft.** On the **Handover** page add the client logo, set ownership steps / welcome message, optionally set a **password** to gate the page.
- [ ] **draft → ready.** Click **Mark ready to hand over →** (state `ready`). Now the public page resolves.
- [ ] **Send the `/h/:id` link.** Copy the public link with **Copy public link** — it points at `/share/:id`, which carries social-preview meta (OG/Twitter card) and forwards the human to the real delivery page at `/#/h/:id`. The share card renders a clean "Your community is ready" preview; a password-gated handover stays opaque in the preview (no scope leak).
- [ ] **Hand over the management docs.** The delivery page carries the included build scope, the bot checklist, and the manual-steps punch-list so the client can finish boost-locked items and take ownership.
- [ ] **Confirm hand-over.** Once they've got it, click **Confirm hand-over ✓** (state `handed_over`).

---

## 6. Client Check-In — did they open it?

The handover page tracks real client engagement so you know the delivery actually landed.

- [ ] **Watch the engagement signal.** The Handover page shows **Client engagement** from `GET /handovers/:id/analytics` + `/views`: whether the page was opened, how many times, when it was last seen, plus share-card views and report-download / docs-expand events (the public delivery page fires anonymous beacons to `POST /h/:id/event`).
  - **○ Not opened yet** — they haven't looked. Nudge them.
  - **✓ Opened N× · last …** — they're in. Good signal to follow up on ownership / upsell.
- [ ] **Mind the stuck warning.** A *delivered* handover (not a draft) that's older than 72h and **never opened** surfaces as stuck on the dashboard. Chase it.

---

### Quick reference — what writes to a real guild?

| Action | Touches client guild? |
|---|---|
| Capture snapshot | No (reads source only) |
| 🔍 Readiness check (`/builds/readiness`) | No |
| ◐ Dry-run | No |
| /preflight authority audit | No (reads perms only) |
| Build canary → (test guild) | Writes a **test** guild only |
| **Build the server →** (canary off) | **Yes — this is the gate** |

CLI fallback (`apps/api/src/scripts/build.ts`) follows the same safety contract: it dry-runs unless you pass `--apply`, and `--apply` is refused without both a real `--guild` and a `DISCORD_BOT_TOKEN`.
