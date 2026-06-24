# Disco — Security Audit Report

**Date:** 2026-06-24 · **Scope:** full monorepo (apps/api, apps/web, apps/landing, apps/worker, packages/\*)
**Method:** 6 parallel specialized read-only audit agents (secrets, injection/validation, authz/IDOR, Stripe money-path, transport/deps, Discord/SDK), every CRITICAL/HIGH then **hand-verified against the source** before any fix (audit agents rubber-stamp — findings here cite read code + a concrete exploit path).

## Executive summary

The recently-hardened defenses **all verified holding**: JWT-secret boot-guard genuinely blocks a weak `SESSION_SECRET`; CORS is `credentials:false` + allowlist; `/config` is auth-gated; the Stripe webhook is fail-closed (raw-body HMAC, timing-safe compare, ±300s replay window, `payment_status` gating); the bot token is env-only (never persisted/logged/returned); no secret reaches the client bundle; git history is clean.

One **CRITICAL** (arbitrary file write via bundle import) and two **HIGH** (rate-limiter proxy bypass; vulnerable `undici`) are real and fixed this session. The largest structural item — a **latent multi-operator IDOR** — is **not exploitable today** (no second operator can authenticate) and is documented as the hard prerequisite before onboarding operator #2.

| Severity | Count | Status |
|---|---|---|
| CRITICAL | 1 | ✅ fixed |
| HIGH | 3 | ✅ all fixed (incl. the multi-op IDOR foundation, adversarially reviewed) |
| MEDIUM | 6 | ✅ all fixed (incl. job-logs SSE scoping) |
| LOW | 4 | ✅ 3 fixed · 📝 1 noted (dev-only deps) |
| INFO (defenses confirmed) | 14 | ✓ holding — do not "re-fix" |

---

## CRITICAL

### SEC-discbundle-pathtraversal — Arbitrary file write via `.discobundle` asset keys ✅ FIXED
`apps/api/src/server.ts:287` → `packages/sdk/src/storage.ts:31`
`POST /bundles/import` writes every `assets` entry via `store.putAt(key, …)`; the key was validated only as `z.record(z.string(), z.string())` and `putAt` did `join(root, key)` + `writeFile` with no containment. A bundle with key `../../../etc/cron.d/x` (or `…/apps/api/dist/index.js`) writes attacker bytes outside the storage root → code execution. Checksum doesn't help (attacker recomputes it over their own content).
**Fix:** (1) schema tightened to `z.record(AssetKey, z.string())` so a bad key is rejected at parse (400); (2) `putAt` now resolves the path and throws unless it is contained within the root (defense-in-depth for every caller). Test: a traversal key is rejected and writes nothing outside root.

---

## HIGH

### SEC-ratelimit-trustproxy-bypass — Rate limiters collapse behind the Cloudflare Tunnel ✅ FIXED
`apps/api/src/server.ts:30`
`Fastify({ logger:false })` left `trustProxy` off, so behind the tunnel every request's `req.ip` is the proxy → `login:${ip}` and `h:${ip}:${id}` share one bucket for all clients (brute-force isolation lost; one attacker can also DoS the shared budget).
**Fix:** `trustProxy: true` so `req.ip` resolves from `X-Forwarded-For` to the real client.

### SEC-undici-dos-advisory — `undici <6.27.0` (HIGH) shipped transitively via discord.js ✅ FIXED
`pnpm audit --prod`: `discord.js@14.26.4 → undici@6.24.1` (GHSA-35p6-xmwp-9g52 WebSocket DoS + header-injection). Reachable in live mode.
**Fix:** root `pnpm.overrides` pins `undici >=6.27.0`; `pnpm install` + re-audit confirms 0 prod-high.

### SEC-multiop-idor — Latent IDOR: no owner column on any domain table ✅ FIXED (foundation landed + adversarially reviewed)
`repoScope.ts` (new chokepoint); `server.ts` (every owned route); `prisma/schema.prisma`; the 4 record types
**Fixed:** `ownerEmail` added to Snapshot/Client/Job/Handover/BuildEvent. A single `scopeRepo(base, actor)` wrapper is the one access-control chokepoint — a regular operator reads/mutates only their own records; an admin (the sole/default `OPERATOR_EMAIL`, via `roleFor`) bypasses, so single-operator behavior is unchanged and scoping engages only once a non-admin operator #2 exists. Every authenticated owned-resource route flows through `scoped(req)`; creates stamp `ownerEmail` from the operator (never from request body); system/public paths use raw repo deliberately. **Adding operator #2 is now one config line.**
**Adversarial review (4 red-team agents, all converged):** found ONE missed route — `GET /snapshots/:id/export` on raw repo — fixed + regression-tested. `owns()` hardened against an empty-email match. Everything else (wrapper logic, delegation completeness, SYSTEM_ACTOR isolation, role derivation, owner-stamp integrity) verified sound.
**Verified:** +6 IDOR-attempt tests; live — a valid non-admin 2nd-operator token gets 404 on read/export and 0 on list across every owned resource, the owner gets 200.

---

## MEDIUM

- **SEC-disco-webhook-token-plaintext** ✅ FIXED — `GET /jobs/:id` returned the full manifest, whose entries embed live Discord webhook `id:token`. Now redacted on read (token half stripped) so it never reaches the browser/DB-backup-via-API. (At-rest encryption of the stored manifest is a larger follow-up; redaction closes the API/client exposure now.)
- **SEC-handover-public-scope-leak** ✅ FIXED — public `/h/:id` served full build scope/manual-steps for any non-password handover, **including `draft`** (work-in-progress). Now returns 404 for `state === 'draft'`.
- **SEC-stripe-memoryrepo-nonatomic-dedup** ✅ FIXED — in-memory repo had no uniqueness, so concurrent webhooks could double-fulfil (non-Prisma deploys). `MemoryRepo.addClient` now throws on a duplicate `stripeSessionId`, so the existing catch dedups.
- **SEC-no-security-headers** ✅ FIXED — added `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, a scoped CSP on `/share`, and `default-src 'none'` + nosniff on `/assets/*` (the SVG-served-as-`image/svg+xml` stored-XSS angle).
- **SEC-500-error-message-leak** ✅ FIXED — `/snapshots/capture`, `/bundles/import`, `/guilds`, `/preflight` reflected raw `err.message` (DB/fs/library internals). Now a generic client message + server-side log.
- **SEC-joblogs-sse-idor** ✅ FIXED — `GET /jobs/:id/logs` SSE now ownership-gates (404) BEFORE hijacking the socket, so a non-owner can't stream another operator's build logs. Landed with the owner-scoping foundation.

## LOW

- **SEC-stripe-scaffold-accepts-unsigned** ✅ FIXED — no-keys mode accepted forged webhooks; the unsigned-accept branch is now gated on non-production (a no-key prod returns 400).
- **SEC-stripe-webhook-no-ratelimit** ✅ FIXED — added a per-IP rate limit + explicit bodyLimit on `/stripe/webhook`.
- **SEC-disco-persistasset-no-host-allowlist** ✅ FIXED — `persistAsset` now allowlists `cdn.discordapp.com`/`media.discordapp.net` + https only (defense-in-depth; no attacker-controlled host reaches it today).
- **SEC-snapshots-mutating-routes-unvalidated-body** ✅ FIXED — `POST /clients` + `/snapshots/capture` now bound input lengths.
- **SEC-devdep-vitest-vite-esbuild** 📝 NOTED — dev-only advisories (not in `--prod`). Bump deferred (toolchain-major risk > reward); not a deployed attack surface.

## INFO — defenses confirmed holding (do **not** re-fix)
JWT role derived-at-verify (un-spoofable) · boot-guard blocks weak secret · CORS credentials:false+allowlist · `/config` gated · handover password = bcrypt + fail-closed + pre-data + rate-limited · Activity SSE carries only coarse category (no per-record data) · Stripe raw-body HMAC + timingSafeEqual + ±300s + payment_status + fail-closed · 1MB body default (JSON-bomb defended) · constant-time secret compares · `/share` + `/assets` HTML/path escaping · findReplace escaped (no ReDoS) · no user-URL SSRF · bot-token containment · MockGuild gate fail-safe · tunnel exposes only the web preview · no client secrets · no committed secrets.
