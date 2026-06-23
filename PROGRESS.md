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

## Phase 3 — `@disco/sdk` (typed Discord wrapper, discord.js v14)
- ⏳ U3.1 REST/gateway client wrapper, intents, rate-limit aware queue surface.
- ⏳ U3.2 Capture adapters (guild→snapshot reads) behind an interface, with a **MockGuild** impl.
- ⏳ U3.3 Apply adapters (snapshot→guild writes) behind an interface, with a **MockGuild** impl.
- ⏳ U3.4 Bot detection + readable-trace scraping.
- ⏳ U3.5 Webhook content re-post (system channels only).

## Phase 4 — `@disco/core` engines wired to SDK
- ⏳ U4.1 Snapshot engine (capture → typed artifact, assets to object storage).
- ⏳ U4.2 Rebuild engine (dependency-ordered, resumable, rate-limited, dry-run) over SDK adapters.
- ⏳ U4.3 Integration test: mock-guild snapshot → dry-run → build → report, asserted end-to-end.

## Phase 5 — apps/api + apps/worker (Fastify + BullMQ + Prisma)
- ⏳ U5.1 Prisma schema (snapshots, jobs, clients, manifests, reports, handovers, users).
- ⏳ U5.2 Auth (JWT + bcrypt operator), REST routes, SSE/WS job-log channel.
- ⏳ U5.3 BullMQ worker running snapshot/build jobs resumably; live log streaming.
- ⏳ U5.4 Invite-link/permission-integer generator endpoint.

## Phase 6 — apps/web (premium dashboard, §8)
- ⏳ U6.1 Vite+React+Tailwind shell, design system (read frontend-design SKILL first).
- ⏳ U6.2 Stepper: Connect → Snapshot(library+diff) → New Client → Rebrand(override+preview) → Build(dry-run+live log) → Report → Handover.
- ⏳ U6.3 Snapshot library/diff, Client list, Build queue, Rebuild Report, Bot Setup Checklist, Handover page + Ownership Transfer Checklist + upsell tracker.

## Phase 7 — infra + docs
- ⏳ U7.1 docker-compose (api, worker, redis, postgres, web) + healthchecks.
- ⏳ U7.2 README 5-minute quickstart, intents/permissions, "cannot do & why".
- ⏳ U7.3 HANDOFF.md: what's mocked vs live, exact safe first real-server run.

## Known environment gaps (this machine)
- `docker` not installed → compose authored & validated by config, but not booted here. Flagged in HANDOFF.
- No real bot token → all Discord I/O verified against MockGuild + fixtures only. Live run is the operator's hard gate.
