# ADR-0004: One Repo interface, two implementations (InMemory demo + Prisma prod) selected at runtime

- Status: Accepted
- Date: 2026-06-25
- Deciders: Disco operator (autonomous build)

## Context

Disco is a one-operator business that sells $30–60k custom Discord community builds: it snapshots a
template guild, rebrands it per client (term-swaps, brand colors, links), rebuilds into a fresh guild,
and delivers via a handover page. Two consumers need the same persistence: the API server
(`apps/api/src/server.ts`) and the BullMQ worker (which imports the very same module — see the
re-export comment at `apps/api/src/runtime.ts:71`).

The forces:

- **Zero-setup demo must work cold.** A prospect (or the operator showing off) should `pnpm dev` and see
  a populated dashboard — a sample template + a sample client — with no Postgres, no Redis, no Discord
  token. `apps/api/src/env.ts:1-2` makes every env var optional precisely so the API "boots with zero
  configuration."
- **Production must be durable.** Resumable, non-duplicating builds depend on a persisted
  `Job.manifest` shared with the worker as the single source of truth (`apps/api/src/prismaRepo.ts:34-39`).
  That requires Postgres.
- **Business logic must not care which.** Route handlers, the build processor, and the worker all issue
  the same calls (`addJob`, `updateHandover`, `listSnapshots`, …) regardless of backing store.

The naive path — sprinkle Prisma calls through the handlers — would make the demo impossible to run
without a database and would couple every feature to Postgres.

## Decision

Define a single persistence port, `interface Repo` (`apps/api/src/repo.ts:63-105`), as ~40 async
methods over domain types from `@disco/schema` (`SnapshotRecord`, `Client`, `Job`, `Handover`, plus
local DTOs like `AuditEntry`/`BuildEventEntry`). All methods are `Promise`-returning even on the
in-memory side (`repo.ts:158` returns synchronously but is `async`) so the interface is Prisma-shaped
from day one and the two implementations are structurally interchangeable.

Two adapters implement it:

- **`InMemoryRepo`** (`repo.ts:111-325`) — `Map`-backed stores (`repo.ts:112-114`). Its constructor
  seeds a sample snapshot (`snap_sample`, "Acme Slots HQ") and a sample client (`client_nova`) on
  construction (`repo.ts:116-156`) so the dashboard is useful on first boot. It bounds memory for a
  long-lived demo (audit log capped at 1000 — `repo.ts:298`; build events 2000 — `repo.ts:310`;
  handover views 5000 — `repo.ts:320`).
- **`PrismaRepo`** (`apps/api/src/prismaRepo.ts:40-348`) — Postgres via a memoized singleton
  `PrismaClient` (`prismaRepo.ts:16-20`, one pool per process). It is a drop-in: same method
  signatures, same return types.

Selection is one line of dependency inversion at the composition root,
`makeRepo()` (`apps/api/src/runtime.ts:11-13`):

```ts
export function makeRepo(): Repo {
  return usePrisma() ? new PrismaRepo() : new InMemoryRepo();
}
```

`usePrisma()` is simply `env.databaseUrl.length > 0` (`env.ts:26`), i.e. presence of `DATABASE_URL`.
Callers receive the interface, never a concrete class: `index.ts:6` and `server.ts:28`
(`const repo = opts.repo ?? makeRepo()`). Business logic depends on `Repo`, not on Postgres.

The translation layer is the **`toX()` mapper pattern** in `PrismaRepo` — private arrow functions
`toSnapshot` (`prismaRepo.ts:44-62`), `toClient` (`116-133`), `toJob` (`173-198`), `toHandover`
(`252-272`). Each maps a DB row ⇄ domain type and absorbs the impedance mismatches Postgres introduces:

- **Dates ⇄ ISO strings.** DB `Date` columns become ISO strings via `iso()` (`prismaRepo.ts:22`,
  e.g. `capturedAt: iso(r.capturedAt)` at `:53`); writes parse back with `new Date(...)` (`:87`).
  The in-memory side already stores ISO strings (`now()` at `repo.ts:109`), so the domain type sees
  ISO everywhere.
- **Tolerant Json reads.** Json columns are re-validated through their zod schemas on read so a single
  legacy/partial row can't 500 a whole `listJobs()`: `safe(JobManifest, r.manifest)` (`prismaRepo.ts:190`,
  helper at `:24-29`), and `Snapshot.parse(r.artifact)` (`:54`) restores defaults losslessly — which
  `execute.ts` resume depends on (`prismaRepo.ts:34-38`).
- **Nullable Json.** JS `null` must become a DB `NULL`, not a JSON `null` literal —
  `nullableJson()` (`prismaRepo.ts:30-32`, used at `:218`).
- **Write-only secrets.** `passwordHash` is never on the `Handover` domain type; both adapters derive
  only `hasPassword: !!r.passwordHash` (`prismaRepo.ts:261`; in-memory strips it via `publicHandover`
  at `repo.ts:290-293`) and expose the raw hash solely through `getHandoverPasswordHash`.

The two adapters are held to behavioral parity by contract, not just type-shape. `addClient` enforces
the `@unique(stripeSessionId)` invariant in memory with a synchronous duplicate scan
(`repo.ts:194-203`) to mirror Prisma's unique index (`prismaRepo.ts:142-144`) so Stripe fulfilment is
exactly-once on both. `deleteClient`/`deleteSnapshot` unlink dependents (set FK to `null`, keep build
records) identically in both (`repo.ts:211-216`, `182-185` vs `prismaRepo.ts:165-170`, `110-113`).
`seedIfEmpty()` (`runtime.ts:30-69`) reproduces the in-memory seed for Postgres so first boot is
equally populated either way.

## Consequences

**Positive**
- The demo runs with zero infra — no DB, queue, or token (`env.ts:1-2`). Onboarding and sales demos
  are `pnpm dev`.
- Business logic is testable against `InMemoryRepo` with no database fixture; tests inject a repo via
  `server({ repo })` (`server.ts:28`).
- Production is a config flip, not a code change: set `DATABASE_URL` and `makeRepo()` returns
  `PrismaRepo`. The worker and API share one adapter, so there is no query-logic drift
  (`runtime.ts:71`).
- Swapping Postgres for another store later means writing one new `Repo` implementation, not editing
  call sites.

**Negative**
- **Two implementations to keep in sync.** Every new method or invariant must land in both, and the
  compiler only enforces the signature, not the behavior. The parity hacks (synchronous unique-scan,
  dual unlink) are load-bearing and easy to forget; a divergence here is a real-money correctness bug.
- **The mappers are hand-written boilerplate.** Four `toX()` functions plus per-field write blocks
  (`updateJob` at `prismaRepo.ts:230-249`) must be edited on every schema change; nothing generates them.
- **`InMemoryRepo` silently loses data on restart** and its sort/filter are linear scans
  (`listAudit` at `repo.ts:300-305`). Acceptable for a demo, dangerous if ever pointed at real work.

**Neutral**
- Persistence selection is independent of Discord live/demo mode and of the queue: `usePrisma()`,
  `useQueue()`, and `isLiveMode()` are three orthogonal switches (`env.ts:22-27`). You can run Postgres
  with the in-process job channel, or in-memory with a live token.
- `assertSecureEnv()` (`env.ts:35-47`) treats "Postgres is configured" as production-shaped and refuses
  to boot on the public dev session secret — so choosing the Prisma backend tightens security posture.

## Alternatives considered

1. **Call Prisma directly from route handlers (no port).** Rejected: it couples every feature to
   Postgres, makes the zero-setup demo impossible (you'd need a DB to see the dashboard), and forces a
   live database into unit tests. The whole "boots with zero configuration" property (`env.ts:1-2`)
   would be lost.

2. **A single Prisma adapter plus SQLite for the "demo."** Rejected: still requires a file, migrations,
   and a Prisma generate step before anything renders, and SQLite's Json/`@unique` semantics differ
   from Postgres — so the demo would no longer be a faithful, zero-dependency preview. The `Map`-backed
   store needs nothing and seeds itself in its constructor (`repo.ts:116-156`).

3. **A generic ORM/repository abstraction or auto-generated mappers (e.g. Prisma types straight through
   to the API).** Rejected: leaking Prisma row types (with `Date` columns and `Prisma.JsonValue`) into
   handlers re-couples the app to the ORM and skips the validation boundary. The explicit `toX()`
   mappers are the place where Dates become ISO strings and Json columns get re-validated through zod
   (`prismaRepo.ts:24-32, 44-62`) — that tolerant-read boundary is exactly what keeps one bad row from
   500-ing `listJobs()`, and it only exists because the mapping is explicit.
