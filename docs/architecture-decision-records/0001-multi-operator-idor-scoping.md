# ADR-0001: Owner-scoping as a single IDOR chokepoint

- Status: Accepted
- Date: 2026-06-25
- Deciders: Disco operator (autonomous build)

## Context

Disco is a single-operator platform today: one person sells $30–60k custom Discord
community builds, snapshots a template server, rebrands it per client, rebuilds it into a
fresh guild, and delivers a handover page. But the data model is multi-tenant-shaped —
every owned resource (snapshots, clients, jobs, handovers, build-events, handover-views)
already carries an `ownerEmail` string, and `roleFor` (`apps/api/src/auth.ts:17`) derives a
role from config so a second operator is "one line" away (`auth.ts:11-13`).

The risk is the classic IDOR (Insecure Direct Object Reference) bug class: an authenticated
route reads or mutates an owned resource by id straight off the raw `repo`, forgetting to
check ownership. With ~40 authenticated routes touching owned records in
`apps/api/src/server.ts`, relying on each route to remember `if (rec.ownerEmail !== me)
return 404` is a guarantee that one of them eventually won't — and the day operator #2
exists, that route leaks or lets them mutate operator #1's $40k build.

The forces: (1) we want multi-operator isolation to be correct-by-construction, not
per-route discipline; (2) we must not regress single-operator behavior, which is the only
live case; (3) some paths are *deliberately* cross-tenant or unauthenticated (the shared
marketplace, the public client handover page, Stripe fulfilment, the worker) and must keep
working without owner scoping.

## Decision

Introduce one chokepoint — `scopeRepo(base, actor)` in `apps/api/src/repoScope.ts:28` —
that wraps a `Repo` so every owner-sensitive read/list/mutation filters by `actor`. The wrap
is total: each owned method is re-implemented to gate on ownership via the local `owns()`
predicate (`repoScope.ts:32-33`):

- **Reads** return `undefined` for a non-owned record (`gate`, `repoScope.ts:34`), so the
  calling route's existing not-found handling 404s it — e.g. `getSnapshot`/`getJob`/
  `getHandover` (`repoScope.ts:43,61,66`).
- **Lists** `.filter(owns)` out other operators' rows — `listSnapshots`/`listClients`/
  `listJobs`/`listHandovers`/`listBuildEvents` (`repoScope.ts:38,51,60,68,77`).
- **Mutations** re-fetch the target, check `owns()`, and no-op to `undefined` otherwise, so
  the route 404s — `updateSnapshot`/`deleteSnapshot`/`updateJob`/`updateHandover`
  (`repoScope.ts:45-48,63,70`).
- **Creates** delegate straight through (`addSnapshot`/`addClient`/`addJob`/`addHandover`,
  `repoScope.ts:44,53,62,69`); the route stamps `ownerEmail: operatorOf(req)` at insert
  (`server.ts:280,525,833,1133`).

The actor comes from the session. `actorOf(req)` (`server.ts:88-91`) reads the verified
JWT session and returns `{ email, role }`, or `SYSTEM_ACTOR` when there's no session.
`scoped(req)` (`server.ts:92`) is the one-liner routes call: `scopeRepo(repo, actorOf(req))`.
Grep confirms the pattern is pervasive — owned routes uniformly do `const r = scoped(req)`
or `await scoped(req).getX(...)` (e.g. `server.ts:167,193,210,500,562,765,809,901,929`).

**Admin bypass.** `owns()` short-circuits `true` when `actor.role === 'admin'`
(`repoScope.ts:29,33`). `roleFor` makes the configured `OPERATOR_EMAIL` (and anything in
`ADMIN_EMAILS`) an admin (`auth.ts:14-18`). So the sole/default operator is admin and sees
everything — single-operator behavior is byte-for-byte unchanged, and scoping only *engages*
once a non-admin operator #2 logs in. The empty-string guard `r.ownerEmail !== ''`
(`repoScope.ts:32-33`) ensures system/seed rows (owner `''`) are admin-visible-only and can
never collide with a real operator.

**The chokepoint property.** A new authenticated route that reads an owned resource is
secure-by-default *as long as it goes through `scoped(req)`*. It physically cannot return
another operator's record, because the wrapped method returns `undefined` before the route
ever sees it. The route author writes zero ownership logic.

**Deliberate raw-repo escape hatches.** Three classes of path skip scoping on purpose and
use the bare `repo`, each gated by its own rule rather than operator ownership:
1. *Cross-operator-by-design*: the shared marketplace catalog — `listSharedSnapshots` is the
   one list method left unfiltered (`repoScope.ts:41`), and the route sanitizes each item
   structure-only before returning (`server.ts:467-468`).
2. *Public capability paths*: the client handover page `GET /h/:id` and its OG/beacon/survey
   siblings read `repo.getHandover(id)` raw (`server.ts:617,631,1207,1250`), gated by the
   unguessable handover id + a not-draft + optional-password check — not by owner.
3. *System paths*: Stripe fulfilment creates a client on `repo` and stamps
   `ownerEmail: env.operatorEmail` itself (`stripe.ts:248,260`); the worker
   `buildProcessor` emits build-events on `repo`, inheriting `ownerEmail` from the owning job
   row (`buildProcessor.ts:28-29,43`). Their actor analogue is `SYSTEM_ACTOR`
   (`repoScope.ts:14`), an admin-role principal explicitly documented as "never derive from
   request input."

## Consequences

Positive:
- IDOR for owned resources is closed by construction. Adding operator #2 needs no per-route
  audit — only confidence that new routes use `scoped(req)`.
- Single-operator behavior is provably unchanged (admin bypass), so this ships with zero
  user-visible change and de-risks the future multi-tenant pivot.
- The bug class is concentrated: reviewers grep for `repo.getX`/`repo.updateX` *not* behind
  `scoped(`, and every hit is one of three known, commented escape hatches.

Negative / tradeoffs:
- Mutations cost an extra read (re-fetch + `owns()` before the write, `repoScope.ts:45,63`).
  Negligible at this scale, but it's an N+1-ish pattern baked into the wrapper.
- `scopeRepo` must mirror the `Repo` interface exactly; a new owned method added to `Repo`
  without a corresponding wrapper entry would fall through and silently *not exist* on the
  scoped view (a compile error in strict TS, but a maintenance coupling nonetheless).
- The safety is contingent on routes choosing `scoped(req)` over `repo`. The chokepoint
  removes the *ownership-logic* footgun but not the *which-repo* footgun — a careless author
  can still reach for the raw `repo`. This is mitigated by convention + comments
  (`server.ts:85-87`), not by the type system.

Neutral:
- Authorization lives at the repo-wrapper layer, not in a middleware or the persistence
  driver. The DB still stores all operators' rows together; isolation is enforced in app
  code, so a raw DB query bypasses it (acceptable — only the operator and the worker touch
  the DB).

## Alternatives considered

1. **Per-route ownership checks.** Each handler does `if (rec.ownerEmail !== me) return
   reply.code(404)`. Rejected: it's exactly the IDOR-prone status quo — correctness depends
   on ~40 handlers each remembering the check, and the failure mode is silent until operator
   #2 exists. No central place to audit.

2. **Row-level security in the persistence layer (Postgres RLS / a tenant column predicate
   in PrismaRepo).** Strongest isolation, survives raw queries. Rejected for now: Disco runs
   in-memory or Postgres interchangeably (`usePrisma()`), so RLS wouldn't cover the in-memory
   driver; it couples auth to the DB engine; and it complicates the deliberate cross-tenant
   (marketplace) and system (worker/Stripe) paths that need to see across owners. The
   app-layer wrapper handles all drivers uniformly and keeps the escape hatches explicit.

3. **A Fastify preHandler that injects scope.** A middleware could attach a scoped repo to
   `req`. Rejected as redundant: `scoped(req)` is already a one-liner the route calls, and an
   implicit injected repo would *hide* the choice between scoped and raw — making the
   deliberate public/system raw-repo usages look like bugs and the scoping invisible to
   reviewers. Explicit `scoped(req)` at the call site keeps the security decision legible.
