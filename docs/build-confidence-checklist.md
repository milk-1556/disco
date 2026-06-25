# Build confidence checklist — "can I ship this to a real client yet?"

A $30–60k Discord build is delivered once. This checklist is the gate between "the demo works" and
"I'll point this at a paying client's brand-new server." **Every YES must be backed by evidence you can
re-run** — a test, an endpoint response, or a document — not a feeling. The honesty rule throughout:
anything Discord can't clone is a *named manual step with a reason*, never a silent skip.

The system runs every check below against a **MockGuild** today, so confidence is built before any real
token is used. The single remaining gate is deliberately yours (see §7).

---

## 1. The build will produce exactly what I previewed

**Gate:** the plan I approve is the plan that runs — no surprises mid-build.

- ✅ **Dry-run is the same engine as the real build.** `runBuildJob` runs `rebuildGuild` with `dryRun:true`
  → identical plan, zero writes. Evidence: the e2e spine builds dry-run → real and asserts the same object
  counts (`apps/api/test/e2e.test.ts`), and the composability merge dry-ran end-to-end with 0 errors.
- ✅ **Readiness gives a verdict before you spend a build.** `POST /builds/readiness` returns
  `ready | ready_with_warnings | blocked` from `auditBuildLimits` (Discord hard limits + boost-tier
  feasibility) + a full dry-run report (`wouldCreate`, `wouldSkip`, `manualSteps`, `skipped[]`).
  Evidence: `apps/api/test/e2e.test.ts` › "readiness expansion".

**Trust when:** readiness returns `ready` (or you've read every line of `ready_with_warnings`).

---

## 2. A failure will NOT strand a half-built client server

**Gate:** the scariest failure mode — a crash partway through, leaving the client with a broken,
half-configured server and no clean way forward.

- ✅ **Builds resume from the failed step, not from scratch.** The manifest is checkpointed after every
  object and every step transition; a retry re-enters only the incomplete steps (N+1).
- ✅ **Resume never duplicates.** Reconciliation adopts objects an earlier attempt already created (by
  name+kind) instead of re-creating them, so a retried build converges instead of doubling.
- ✅ **This is PROVEN, not assumed.** `apps/api/test/resume.test.ts` forces a hard crash mid-structure,
  then resumes against the same guild and asserts: every step finishes, a completed step is **not** re-run
  (`attempts === 1`), the crashed step **is** re-entered (`attempts ≥ 2`), and **no role or channel name
  appears twice**.
- ✅ **Item-level rejections degrade, they don't abort.** A boost-locked sticker / hierarchy-blocked perm
  / transient 5xx is recorded in `skipped[]` → flows to the handover's manual steps; only a dead token or
  8 consecutive failures aborts loud (never a hollow "success"). See `rebuild/execute.ts` `tolerate()`.

**Trust when:** `resume.test.ts` is green. Re-run it after any change to the rebuild engine.

---

## 3. The bot can actually perform the build on THIS guild

**Gate:** the bot is in the target server with the permissions the build needs — caught *before* the
build starts, not at the first failed API call.

- ✅ **Token validity + permission audit on the real target.** `POST /builds/readiness` with a
  `targetGuildId` runs a live probe: `getBotPermissions()` → `auditAuthority()`, returning `hasAdmin`,
  `ok`, and the exact `missing[]` permissions with *why* each is needed. A missing required permission is
  a hard **block** (the verdict flips to `blocked`).
- ✅ **Reachability = rate-limit headroom.** A clean probe response means Discord answered without
  throttling; the build's `resilient()` wrapper then absorbs transient 429/5xx with bounded retries.
- ✅ **Degrades gracefully in demo.** With no token, the probe runs against MockGuild and is clearly
  labelled `mode: "demo"` — no real call, no false confidence. Evidence: `e2e.test.ts` asserts the demo
  probe is reachable with simulated perms.

**Trust when:** readiness `live.permissions.ok === true` against the real guild (live mode), or you've
manually confirmed the bot is invited with the required perms (see `docs/operator-runbook.md`).

---

## 4. If it goes wrong, I'll know exactly where

**Gate:** when a build is slow or fails, you can pinpoint the step — not stare at a spinner.

- ✅ **Per-build trace.** `GET /builds/:id/trace` rolls the manifest + events + metrics into one timeline:
  per-step `status`, `attempts` (retry count), `durationMs`, and per-step object outcomes
  (`created/updated/skipped/failed`), plus `resumes`, `retriedSteps[]`, and total `apiCalls`/`durationMs`.
- ✅ **Lifecycle event log.** `running → resumed → completed/failed` events with human detail, owner-scoped.
- ✅ **Owner-scoped.** A trace is only readable by the build's owner (404 otherwise) — verified in
  `e2e.test.ts` › "build trace".

**Trust when:** you've opened a trace on a real (or demo) build and it reads cleanly — every step `done`,
`attempts === 1`, `resumes === 0`.

---

## 5. I'm not flying blind on my own track record

**Gate:** a recent run of failures is itself a reason to slow down before a high-stakes build.

- ✅ **Operator success rate is surfaced.** Readiness returns `history`:
  `realBuilds / completed / failed / successRate` over your own non-dry, non-canary builds (owner-scoped).

**Trust when:** your recent real-build `successRate` is high — and if it isn't, the readiness response
tells you so *before* you commit the next one.

---

## 6. What the system honestly CANNOT do (and says so)

Confidence includes knowing the edges. These are **manual steps**, surfaced in every report + handover —
never silently skipped:

- **Third-party bots** (MEE6, Carl-bot, ticket tools) — their config lives on the vendor's servers. The
  build detects them and emits per-bot re-invite + reconfigure steps; it does not (cannot) clone them.
- **Boost-locked perks** — banner/splash/extra emoji slots/vanity URL require the *target* server's boost
  tier; flagged as warnings against `targetTier`.
- **Member data & interactive panels** — messages with live buttons/components, member roles/history.
- **Ownership transfer** — Discord requires the owner + 2FA; it's the handover's ownership checklist.

**Trust when:** you've read the dry-run `manualSteps` and they're all things you expected to do by hand.

---

## 7. The remaining gate before the FIRST live build — yours

Everything above is proven against MockGuild. The deliberate, un-automatable gate:

- 🔒 **A real Discord bot token** (`DISCORD_BOT_TOKEN`) — stays the operator's. The token-validity probe
  is built and tested against the mock; the **first live probe + first live build is your call.**
- 🔒 **Stripe go-live keys** — the money path is fail-closed without them (see `docs/stripe-go-live.md`).

**Recommended first-live sequence:** (1) invite the bot to a *throwa/test* guild you own; (2) run
`POST /builds/readiness` with that `targetGuildId` → confirm `verdict: ready`, `live.permissions.ok`;
(3) build with `canary: true` (a tiny verification slice) → inspect the trace; (4) build for real;
(5) only then point it at a paying client. Each step has a green checkmark above backing it.

---

### Re-running the evidence

```sh
# the whole confidence suite
pnpm test                                   # all packages
npx vitest run --root apps/api test/resume.test.ts   # §2 resume proof
npx vitest run --root apps/api test/e2e.test.ts -t "first-build trust"   # §1 readiness + §4 trace
npx vitest run --root apps/api test/load.harness.test.ts                 # capacity (docs/performance-budget.md)
```

A YES on this checklist means the corresponding command is green. Ship when they all are — and the bot
token says go.
