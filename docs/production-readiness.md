# Disco — production-readiness self-review

_Honest assessment after the Dispatch continuous-improvement wave (2026-06-25→26). Every "ready" row cites
re-runnable evidence. This is a self-review by the agent that did the work — read it as a checklist to
challenge, not a victory lap._

## Verdict

**Disco is production-ready for its purpose — a single agency operator (and, now, a scoped team) running
$2k–$60k done-for-you Discord builds — except for three deliberate gates that are the operator's to
open, not the software's.** The whole snapshot → rebrand → build → deliver → get-paid spine is proven,
tested (101 api / 54 core / 28 sdk), owner-scoped, adversarially reviewed, and mobile-safe. What it has
never done is touch a *real* Discord guild or take a *real* card — both by design, behind Max's keys.

## What's ready (with evidence)

| Area | State | Evidence |
|---|---|---|
| **Core pipeline** | Ready | capture/rebrand/rebuild engines are idempotent, resumable (crash → resume from manifest, proven by `apps/api/test/resume.test.ts`), dry-run-first; honest manual steps for anything Discord can't clone. |
| **Multi-operator / white-label** | Ready | DB-backed operators + admin team management + self-service password change; owner-scoping is a single `scopeRepo` chokepoint; adversarial review found + fixed a real ADMIN_EMAILS escalation. `apps/api/test/operators.test.ts`. |
| **Access control** | Ready | Three adversarial reviews this wave (invite link, multi-op auth, seam r9) — every new route owner-scoped, no IDOR, role derived server-side from the JWT, no secret leaks. |
| **Client deliverable** | Ready | The public handover page: branded, password-gateable, a plain-language guide, a validated "Open your Discord server" invite (XSS/phishing-guarded), a survey, and open-tracking — verified mobile-excellent at 375px. |
| **Money tracking** | Ready | Invoiced/paid/outstanding/MRR on Today + Economics; per-client rollup; CSV export for accounting (formula-injection-safe). NOT payment processing (deliberate). |
| **Reliability** | Ready | Pre-flight readiness (token/perm/rate-limit/history), per-build trace, build resume, load harness (docs/performance-budget.md — in-process build knee ~5 concurrent, scale workers past it). |
| **Observability** | Ready | `/health` (status healthy/degraded + db/worker/queue) surfaced in-app; audit log; build events; webhook log; per-route latency + error rates. |
| **Notifications** | Ready | Build-completion + client-delivery-open toasts (owner-scoped, no historical replay, no missed events after the r9 fix). |
| **Operator speed** | Ready | ⌘K command palette (search clients/templates/builds/nav); bulk queue actions; keyboard shortcuts. |
| **Deploy** | Ready-to-configure | `.env.example` (all vars incl. ADMIN_EMAILS + Stripe), `assertSecureEnv` boot-guard, `docker-compose.yml`, `docs/deploy.md` with a going-live checklist. |
| **Abuse hardening** | Ready | Rate-limits on all unauthenticated surfaces (login, change-password, handover event/survey/GET); fail-closed Stripe webhook; CSV/HTML injection defenses. |

## The three gates (Max's, not the software's)

1. **Real Discord bot token** — the first live build. Everything is proven against MockGuild; the
   readiness probe + canary + trace make the first real run safe. Recommended sequence in
   `docs/build-confidence-checklist.md`.
2. **Stripe go-live keys** — only if selling via hosted checkout (the service is also sold by invoice).
   `docs/stripe-go-live.md`; the webhook fails closed without the signing secret.
3. **A public host / named tunnel** — the app runs on localhost; account-less cloudflare quick-tunnels
   are edge-flaky. A named tunnel (Max's CF account) or a Caddy/nginx+TLS box is the durable fix.

## Honest weaknesses / next opportunities (not blockers)

- **No end-to-end test against the real discord.js client** beyond the undici-mock coverage — inherent
  until a token exists.
- **The N+1 view fan-out** on the dashboard/client-opens is now bounded (take:500) but still 2×N queries;
  a dedicated `listRecentOpensForOwner` would be the clean scale fix if handover volume grows large.
- **Single-region, single-box** assumptions (in-process asset store default, one worker) — fine for one
  operator; horizontal scale needs S3 storage + N workers (both already pluggable via env).
- **Landing/marketing** is complete but not deployed (disco.build) — gated on the host.

## Recommendation

Ship it to a real host, invite the first operator, and do the first **live build against a throwaway test
guild** with the readiness+canary flow. That single real run — not more features — is the highest-value
next step, and it's the one thing only Max can trigger. The software is ready to earn.
