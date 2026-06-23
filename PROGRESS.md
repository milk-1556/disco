# Disco — Build Progress

Living task list. Updated every cycle. Legend: ✅ done & verified · 🔨 in progress · ⏳ queued · 🚧 blocked (see BLOCKERS.md)

> Strategy: build the **pure, Discord-independent core first** (schema, rebrand, classification,
> manifest reconciliation) — it's the highest-value logic and fully unit-testable with zero
> Discord access or credentials. Then layer the SDK/bot (needs a token → hard gate for live runs),
> the API/worker/queue, and the dashboard. Everything is verified against a **mock guild + fixtures**
> until the operator knowingly triggers the first real-server run.

## Phase 0 — Scaffold
- ✅ U0.1 Toolchain check (node20, pnpm via corepack, git, gh authed as milk-1556). docker absent — noted.
- ✅ U0.2 Repo cloned, git identity set.
- ✅ U0.3 Root workspace: package.json, pnpm-workspace, turbo.json, tsconfig.base, .gitignore, .npmrc, .env.example, prettier.
- ✅ U0.4 README skeleton + "What Disco cannot do and why".

## Phase 1 — `@disco/schema` (the spine, §3)  ← everything depends on this   ✅ DONE (typechecks, 4 tests)
- ✅ U1.1 Primitives: localRef, permission bitfield, color, snowflake, asset key, url, hex.
- ✅ U1.2 Roles, channels (text/voice/forum/announcement/stage/media + overwrites + forum tags), categories.
- ✅ U1.3 Guild settings, welcome screen, emojis, stickers, automod, detected bots, channel content.
- ✅ U1.4 Brand tokens. Top-level Snapshot + schemaVersion.
- ✅ U1.5 RebrandConfig schema (§4).
- ✅ U1.6 Job + JobManifest + RebuildReport schemas (§6/§7).
- ✅ U1.7 Unit tests: parse/round-trip a representative snapshot fixture; reject malformed.

## Phase 2 — `@disco/core` pure engines (§4, §5, §6 logic — no Discord I/O)   ✅ DONE (typechecks, 22 tests)
- ✅ U2.1 Rebrand transform `Snapshot + RebrandConfig → RebrandedSnapshot` (deterministic, idempotent, reversible).
- ✅ U2.2 Brand-token auto-extraction (proper nouns, hex colors, urls).
- ✅ U2.3 Channel content classification heuristics (system_content vs member_chat).
- ✅ U2.4 Manifest reconciliation (idempotency: build twice → no duplicates) — pure planner over manifest state.
- ✅ U2.5 Rebuild **plan** ordering (dependency-ordered step list + dry-run report), Discord-free.
- ✅ U2.6 Golden-file tests for rebrand; idempotency tests for manifest; classification tests.

## Phase 3 — `@disco/sdk` (typed Discord wrapper, discord.js v14)   ✅ DONE (typechecks vs discord.js types; live-gated)
- ✅ U3.1 Real discord.js v14 client (REST + Routes) implementing CapturePort+ApplyPort, rate-limit
      queue from discord.js, asset store (disk/memory/S3-ready). LIVE-GATED: needs a token to RUN.
- ✅ U3.2 Capture port + **MockGuild** read impl (in-memory, structuredClone reads).
- ✅ U3.3 Apply port + **MockGuild** write impl (create/edit/reorder/overwrites/webhook/listExisting).
- ✅ U3.4 Bot detection + readable-trace scraping (vendor recognition by app-id/username).
- ✅ U3.5 Webhook content re-post (system channels only; preserve-author OR generic-server identity).

> Port interfaces (CapturePort/ApplyPort) + capture/rebuild engines live in `@disco/core`; `@disco/sdk`
> provides the MockGuild impl now and the real discord.js client (U3.1) next.

## Phase 4 — capture + rebuild engines (over the ports)   ✅ DONE (typechecks, 4 integration tests)
- ✅ U4.1 Snapshot engine: capture → typed artifact, localRef assignment, classification, bot detect,
      mention rewriting, brand-token extraction, asset persistence; schema-validated output.
- ✅ U4.2 Rebuild engine: dependency-ordered, idempotent (reconcile), resumable (manifest/steps), dry-run.
- ✅ U4.3 Integration test: mock-guild capture → rebrand → dry-run → build → report → re-capture,
      asserting rebrand landed, managed roles skipped, member overwrites skipped, content copied,
      and building twice does not duplicate.

## Phase 5 — apps/api + apps/worker (Fastify + BullMQ + Prisma)
- ⏳ U5.1 Prisma schema (snapshots, jobs, clients, manifests, reports, handovers, users) — in-memory Repo
      behind an interface now (Prisma drops in behind the same `Repo` interface).
- ✅ U5.2 Auth (JWT + bcrypt operator) + REST routes + SSE job-log channel — BOOTS + HTTP-verified
      (login, snapshots, diff, capture, rebrand/preview, jobs, report). Runs tokenless in DEMO mode.
- ✅ U5.3 Job runner (`runBuild`) streams logs over SSE (in-process, verified). `@disco/worker`
      BullMQ build worker added (consumes `disco:builds`, runs the SAME engine) — typecheck-verified.
      Wiring `POST /jobs` to enqueue + read results from Postgres is the remaining production step.
- ✅ U5.4 Invite-link/permission-integer generator (administrator=8 + granular set) — HTTP-verified.

## Phase 6 — apps/web (premium dashboard, §8)   ✅ CORE DONE (boots, screenshot-verified end-to-end)
- ✅ U6.1 Vite+React+Tailwind v4 shell. Bespoke "cloning console" design system (read frontend-design
      first): ink base, signature violet→rose **transform spine**, gold-only CTAs, Space Grotesk /
      Inter / Space Mono. Same-origin Vite proxy → no CORS, clean SSE.
- ✅ U6.2 Build console (hero): transform spine with live step nodes, rebrand override panel
      (tokens pre-filled, side-by-side preview), dry-run + build with **streaming SSE log** + progress,
      full Rebuild Report. Verified: login → library → rebrand → dry-run → report, all in-browser.
- ✅ U6.3 Snapshot Library (cards + counts + capture), Build Queue (live progress), Invite generator,
      Bot Setup Checklist + Manual Steps + warnings in the report.
- ⏳ U6.4 Remaining: snapshot diff view UI, New Client intake form, dedicated Handover page +
      Ownership Transfer Checklist + upsell tracker (API + Report already expose the data).

## Phase 7 — infra + docs   ✅ DONE
- ✅ U7.1 docker-compose (api, worker, redis, postgres, web) + healthchecks + Dockerfiles + .dockerignore.
      Config-valid; not booted here (docker absent — see BLOCKERS). Prisma schema added.
- ✅ U7.2 README 5-minute quickstart, intents/permissions table, "What Disco cannot do and why".
- ✅ U7.3 HANDOFF.md: what's built/mocked vs live, exact safe first real-server run, remaining wire-up.

## Known environment gaps (this machine)
- `docker` not installed → compose authored & validated by config, but not booted here. Flagged in HANDOFF.
- No real bot token → all Discord I/O verified against MockGuild + fixtures only. Live run is the operator's hard gate.
