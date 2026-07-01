# Disco — cold self-audit (Dispatch continuous-improvement loop)

_Written 2026-06-25. A demanding, honest read of the whole product before a push to make it
substantially better + production-ready. Corrects assumptions by reading the actual code._

## 1. What state is Disco in?

**Mostly-built, production-adjacent — not a design doc, not a toy.** A pnpm+turbo monorepo with real,
tested engines and a real UI. Concretely:

- **`packages/schema`** — the typed spine (zod): Snapshot, Job/manifest, Handover, RebrandConfig,
  OperatorPrefs, etc. LocalRefs, not raw Discord ids.
- **`packages/core`** — pure engines: capture, rebrand (case/slug-aware find-replace + color/link/asset
  maps), rebuild (idempotent, resumable, dependency-ordered, dry-run), compose (snapshot merge),
  authority + build-limits audits, permission decode. **53 tests.**
- **`packages/sdk`** — discord.js v14 `DiscordGuildClient` + an in-memory `MockGuild` behind one port;
  fault injection; asset store. **28 tests.**
- **`apps/api`** — Fastify + JWT + durable SSE (Redis pub/sub, in-memory fallback), **56 routes**,
  owner-scoped multi-operator, Prisma/Postgres or in-memory repo. **79 tests.**
- **`apps/worker`** — BullMQ build processor (shares `runBuildJob` with the API).
- **`apps/web`** — React + Vite + Tailwind v4, a premium dark "command deck" theme (60 CSS tokens),
  **16 screens**. Genuinely well-designed on desktop (Today screen: one primary action, real empty state).
- **`apps/landing`** — a **complete, polished single-file marketing site** (hero → problem/unlock →
  features → proof → how-it-works → pricing → FAQ → CTA), responsive, reduced-motion-aware.
- **Docs** — 6 ADRs, performance budget + load harness, build-confidence checklist, operator runbook,
  handover best-practices, stripe-go-live.

**The one thing that has never happened: a real Discord build.** Everything is proven against MockGuild;
the first live build is gated on Max's bot token (deliberate). And **it isn't deployed** — it runs on
localhost behind an account-less cloudflare quick-tunnel that is currently flaky/down. `disco.build` is
referenced but not live.

## 2. Who is it for?

Two audiences, already reflected in the code:
- **The operator (Max, primarily)** — the dashboard is the operator's tool for running a productized
  service. A **white-label / network tier** exists in the pricing + the multi-operator owner-scoping
  foundation, so "broader operator launch" is a real near-term path (agencies shipping for many creators).
- **The end client (a casino/betting Discord creator)** — sees only the **public handover page** (the
  branded delivery). This is the face of the $2k–$7.5k+ product.

## 3. What does Disco do that Discord doesn't?

Disco is **not** a Discord alternative. It's an **assembly line for productizing Discord server builds**:
snapshot a proven server once → rebrand every channel/role/link/color for a client → rebuild idempotently
into a fresh guild → deliver a branded handover with ownership transfer. Discord has no templating,
rebranding, versioned-snapshot, or reproducible-build story. Positioning is **niche and sharp**:
done-for-you communities for **casino/betting creators** ($2k+ build, $750/mo management).

## 4. Inventory (condensed)

- **Screens (16):** Today, Library, Build/BuildConsole, Queue, Clients, NewClient, Activity, Economics,
  Operations(Status), Preferences(Defaults), Invite, Setup, SnapshotDiff, HandoverPage, PublicHandover, Login.
- **Backend (56 routes):** auth; snapshots (capture/scan/merge/diff/export/import/marketplace); jobs
  (create/retry/cancel/replay/logs-SSE); readiness + trace; handovers + public delivery + survey +
  analytics; clients; earnings/billing; operator prefs; admin webhooks; dashboard/onboarding; stripe.
- **Engines:** capture, rebrand, rebuild(+manifest resume), compose, authority, permissions, classify.

## 5. What's weak (honest)

- **Not deployed / no reliable public URL.** The biggest production gap. Quick-tunnel is down (CF-side);
  needs a named tunnel (Max's CF account) or a host. `disco.build` not live.
- **Mobile is desktop-first.** Only ~32 responsive utility classes across 16 screens; the nav collapses
  but individual screens (tables, modals, the merge/diff/trace views) need a real 375px pass. The
  discipline says 375 is the primary viewport — the app doesn't yet honor that.
- **No global search / command palette.** With many clients/snapshots/builds an operator has no fast way
  to jump. Every serious operator tool (Linear/Stripe/Vercel) has ⌘K; Disco doesn't.
- **The client-facing PublicHandover is under-polished relative to its stakes.** It's what a paying client
  sees; it deserves a dedicated trust + mobile + empty/loading-state pass.
- **No in-app account management.** No password change, no operator profile, no session/logout affordance
  audit. A multi-operator product needs this.
- **Loading/empty/error-state coverage is uneven.** Today nails it; some screens likely don't.
- **No real Discord build has run.** Gated on Max's token — but the readiness/trace/resume are all proven
  against the mock, so this is a trigger, not missing code.
- **Security surface to re-verify at production scale:** rate-limiting is only on a couple of public
  endpoints; session expiry/rotation; audit completeness; the Stripe path is fail-closed but unexercised live.

## 6. Top 10 improvements — ranked by (user-visible impact × 1/effort)

| # | Improvement | Impact | Effort | Why it ranks |
|---|---|---|---|---|
| **1** | **⌘K command palette + global search** (clients/snapshots/builds/nav) | High | Med | Flagship "feels production-grade" upgrade; the single biggest daily-speed win for an operator with volume. Self-contained, low risk. |
| **2** | **PublicHandover client-deliverable polish** (mobile + trust + states) | High | Med | It's the literal face of a $30k product. Every flaw here is seen by the paying client. |
| **3** | **Mobile-first responsive pass** on the core operator screens (375px) | High | Med | The discipline's stated primary viewport; the app is desktop-first today. |
| **4** | **In-app account & settings** (password change, operator profile, sign-out affordance) | Med | Low | Table-stakes for a multi-operator product; currently absent in-app. |
| **5** | **Consistent loading / empty / error states** audit + fill gaps | Med | Low | Cheap polish that makes the whole app feel finished; Today is the bar. |
| **6** | **Deploy readiness** (named-tunnel + deploy doc, healthcheck, env template) | High | Med* | Biggest production gap, but partly gated on Max's CF/host — prep everything that isn't. |
| **7** | **Keyboard-navigable + a11y pass** (focus rings, aria, contrast, skip-link) | Med | Med | Broadens who can use it; pairs naturally with the command palette. |
| **8** | **Client detail view + build history per client** (currently list-only) | Med | Med | Operators think per-client; a client's full timeline (builds, handovers, earnings) is missing. |
| **9** | **Notifications / activity richness** (build-done toasts, delivery-opened pings) | Med | Med | Closes the loop; the SSE bus already exists to power it. |
| **10** | **Bulk operations + saved filters** on Library/Queue (multi-select actions, filter persistence) | Med | Med | Scales the operator's day as volume grows. |

## 7. Plan

Ship **#1 → #2 → #3** first (each a full commit + adversarial review), then re-rank and continue down
the list. Discipline: snapshot before destructive edits, HEAD+GET verify on any URL claim, `git grep
eyJh` before every push, adversarial money-path review on anything touching auth/user-data, inert-by-default
flags, **375px is the primary viewport**, Linear/Stripe/Vercel restraint, respect the existing violet→rose
brand (do **not** repaint it blue — the brand is intentional and strong). Hard gates unchanged: the real
bot token + Stripe go-live keys stay Max's.
