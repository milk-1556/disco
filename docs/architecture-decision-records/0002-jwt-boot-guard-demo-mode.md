# ADR-0002: JWT auth + the tokenless DEMO-mode boot guard

- Status: Accepted
- Date: 2026-06-25
- Deciders: Disco operator (autonomous build)

## Context

Disco is a single-operator platform that sells $30–60k custom Discord community
builds: it snapshots a template server, rebrands it per client, and rebuilds it
into a fresh guild. The product has two audiences in one binary:

1. The **operator running it for real** — a live Discord bot token, a Postgres
   database, real client records, and a JWT-gated dashboard that must never let
   one operator read another's audit trail or forge a session.
2. **A prospect / the operator's own dev box / a screenshot demo** — someone who
   should be able to `pnpm dev` and immediately drive the *entire* flow (pick a
   server → capture → rebrand → dry-run build → report) with **zero secrets and
   zero infra** (no bot token, no DB, no Redis).

These pull in opposite directions. Zero-config bootability is what makes the
demo and onboarding trivial — but the same "everything has a default" ergonomics
are exactly how production deploys ship with a hardcoded, publicly-known signing
key and get their auth bypassed. We need both: friction-free demo *and* a system
that physically refuses to run production-shaped with insecure secrets.

## Decision

**Auth is stateless JWT over Bearer headers, not cookies.** `signSession`
(`apps/api/src/auth.ts:29`) signs only `{ email }` with `env.sessionSecret` and a
7-day expiry; `verifySession` (`auth.ts:33`) verifies and re-derives the role *at
verify time* from `roleFor` (`auth.ts:17`) so role changes in config take effect
without re-issuing tokens. The role is never trusted from the token body. The
guard `requireAuth` (`server.ts:95`) reads `Authorization: Bearer <jwt>`, calls
`verifySession`, and 401s on any failure; on success it stashes the session on
the request for `scoped(req)` (`server.ts:92`) to build an owner-scoped repo
view. Because auth is a header (not a cookie), CORS needs no credentials, which
lets the public API safely allow any origin (`server.ts:36–40`).

**Every secret has a safe demo default, so the API boots with zero config.**
`apps/api/src/env.ts:5–20` centralizes env access where each value falls back to a
benign default: `sessionSecret` → the *publicly-known* sentinel
`'dev-insecure-session-secret-change-me'` (`env.ts:3`), `operatorEmail` →
`'operator@disco.local'`, `discordBotToken`/`databaseUrl`/`redisUrl` → `''`. Three
derived predicates flip subsystems on only when their secret is present:
`isLiveMode()` (`env.ts:23`, true iff a bot token exists), `usePrisma()`
(`env.ts:26`, Postgres vs in-memory) and `useQueue()` (`env.ts:27`, BullMQ/Redis vs
in-process). `makeRepo` (`runtime.ts:11`) and `makeJobChannel` (`runtime.ts:16`)
switch implementations off these, so with no secrets the app runs entirely
in-memory against MockGuild fixtures — the demo guilds in
`apps/api/src/demoGuilds.ts:12` stand in for the bot's real joined guilds, and
`/guilds` (`server.ts:235`) and `/snapshots/capture` (`server.ts:244`) branch on
`isLiveMode()` to serve them. With no password hash, dev login accepts the literal
password `"disco"` (`auth.ts:24`).

**A boot guard makes the insecure default safe by making it impossible to use in
production.** `assertSecureEnv` (`env.ts:35`) runs first in the boot sequence
(`index.ts:5`, before `buildServer`). It defines "production-shaped" as *any* of:
`NODE_ENV=production`, a live bot token, or a Postgres URL (`env.ts:36`). If the
deploy is production-shaped **and** `SESSION_SECRET` is unset or still equals the
public sentinel, it throws and the process refuses to start (`env.ts:38–42`) —
closing the forge-an-operator-JWT hole. A pure local in-memory demo is *not*
production-shaped, so it boots untouched. A weak-but-custom secret (<32 chars)
warns rather than blocks (`env.ts:43–46`). The invariant: the insecure key can
only ever sign tokens in a throwaway demo, never in a deploy that touches a real
token, real data, or production mode.

## Consequences

Positive:
- One binary serves both demo and production. `pnpm dev` with no `.env` is a
  fully-clickable product — critical for sales demos and onboarding screenshots.
- The dangerous failure mode (prod on a known signing key) is structurally
  unreachable: it's a hard boot crash with a remediation message
  (`openssl rand -base64 48`), not a lint rule or a doc nobody reads.
- Stateless JWT means no session store and trivial horizontal scaling; the API
  and the BullMQ worker share auth with no shared session infra.
- Re-deriving role at verify time keeps the multi-operator scoping
  (`repoScope.ts`) honest even as `ADMIN_EMAILS`/`OPERATOR_EMAIL` change.

Negative / tradeoffs:
- Stateless JWT has **no server-side revocation**: a leaked 7-day token is valid
  until it expires. Rotating `SESSION_SECRET` is the only kill-switch, and it
  invalidates *all* tokens at once. Acceptable for a single-operator tool; would
  need a denylist or short-lived + refresh tokens for many users.
- The "everything defaults" pattern means a *misconfigured* prod (e.g. a deploy
  that forgets `NODE_ENV` **and** runs in-memory **and** has no token) would not
  trip the guard. The guard keys off three concrete signals; it cannot detect a
  deploy that looks exactly like a demo. The three signals were chosen because
  any real deploy trips at least one.
- The dev password `"disco"` and known sentinel are deliberately public — safe
  only because the boot guard fences them out of production. Anyone reading the
  source learns them, so they must never be relied on as a control.

Neutral:
- `<32` char secrets warn but boot, trusting the operator to heed it.
- `OPERATOR_EMAIL` is exposed via `/config` only to authenticated callers
  (`server.ts:142–155`); anonymous callers get just mode + applicationId, so the
  login email and deployment internals aren't harvestable.

## Alternatives considered

- **Server-side / cookie sessions (e.g. Redis-backed).** Gives instant
  revocation and avoids embedding identity in a client-held token. Rejected:
  it forces a session store (Redis) into the zero-config demo path — exactly the
  infra the demo exists to avoid — and cookies drag in CORS-credentials
  complexity that the Bearer-header design sidesteps (`server.ts:36–40`). For one
  operator, `SESSION_SECRET` rotation is a sufficient revocation story.

- **Require `SESSION_SECRET` always (fail to boot with no config).** Simplest
  possible security story — no insecure default to fence off. Rejected: it kills
  the core product property, a tokenless one-command demo. The boot guard
  (`assertSecureEnv`) gets the same end-state safety (no insecure prod) while
  preserving the demo, by scoping the requirement to production-shaped deploys.

- **Validate secrets at first use / per-request instead of at boot.** Catches
  the same misconfig. Rejected: fail-fast at process start (`index.ts:5`) gives
  one loud, unambiguous crash at deploy time with a fix command, instead of
  intermittent 500s or — worse — silently signing forgeable tokens until someone
  notices. A boot guard can't be reached "around" by a code path that forgot to
  call it.
