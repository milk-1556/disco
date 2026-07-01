# Deploying Disco to production

Disco is a pnpm+turbo monorepo: an API (Fastify), a worker (BullMQ), a web dashboard (static SPA), and a
static landing page. It runs in **demo mode with zero secrets** and hardens itself for production via
`assertSecureEnv` (the API refuses to boot in a production-shaped config on the insecure defaults).

This guide is the non-gated path to production. The two things that stay **yours** (never in a config
file, never automated): a real **Discord bot token** and **Stripe go-live keys**.

---

## 1. Prerequisites

- **Postgres 15+** and **Redis 6+** (managed or self-hosted). `docker-compose.yml` provisions both for a
  single-box deploy.
- **Node 20** + **pnpm** if building/running outside Docker.
- A place to serve the built web SPA + landing (any static host / the API can also serve them).

## 2. Configure the environment

Copy `.env.example` → `.env` and fill it in. The load-bearing ones:

| Var | Why it matters |
|---|---|
| `SESSION_SECRET` | **Required in prod.** 32+ random chars (`openssl rand -base64 48`). The API hard-refuses to boot on the dev default once live. Forge-protection for operator JWTs. |
| `OPERATOR_EMAIL` + `OPERATOR_PASSWORD_HASH` | The bootstrap **admin**. Hash: `pnpm --filter @disco/api hash-password`. |
| `ADMIN_EMAILS` | Optional extra env-level admins. **Leave unset** unless you truly need multiple — any email here is admin at login (see the security note in `.env.example`). |
| `DATABASE_URL` | Postgres. Present ⇒ the Prisma backend (not in-memory). |
| `REDIS_URL` | Redis. Present ⇒ builds run through the BullMQ worker (not in-process). |
| `DISCORD_BOT_TOKEN` | **Yours.** Empty ⇒ demo/mock builds. Setting it is what makes the first LIVE build possible. |
| `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` | Optional. Both empty ⇒ scaffold (no charges). Both set ⇒ live sales flow (fails closed without the signing secret). See `docs/stripe-go-live.md`. |
| `WEB_ORIGIN` / `VITE_API_URL` | CORS + where the SPA reaches the API. |

## 3. Migrate + build

```sh
pnpm install
pnpm --filter @disco/api exec prisma migrate deploy   # apply migrations to Postgres
pnpm build                                             # builds all packages + the web SPA
```

## 4. Run the processes

```sh
# API (serves JSON + can serve the built SPA)
pnpm --filter @disco/api start
# Worker (executes builds off the BullMQ queue) — run at least one; scale horizontally for throughput
pnpm --filter @disco/worker start
```

Serve `apps/web/dist` (the operator dashboard) and `apps/landing` (the marketing site) from your static
host, pointed at the API via `VITE_API_URL`. Docker: `docker-compose up -d` runs Postgres, Redis, API,
and worker together.

**Bootstrap the first operator:** the `OPERATOR_EMAIL`/`OPERATOR_PASSWORD_HASH` admin can log in
immediately. From **Preferences → account & team**, invite additional scoped operators (the white-label /
team tier) — each gets their own login and sees only their own clients and builds.

## 5. Health + monitoring

`GET /health` is public and never throws. Point a monitor at it:

```json
{ "status": "healthy", "api": "up", "worker": "up", "db": "up",
  "queue": "redis", "persistence": "postgres", "uptimeSec": 1234, "requests": { ... } }
```

- **Liveness:** HTTP 200 means the API process is up (it stays 200 even when degraded, so a transient
  worker restart doesn't flap the probe).
- **Readiness / alerting:** alert on `status: "degraded"` — set when the queue is Redis-backed but **no
  worker** is consuming, or Postgres is the backend but a read **failed**. `worker` and `db` pinpoint which.
- Per-route latency + error rates are in `requests` (see `docs/performance-budget.md` for budgets and the
  load harness for capacity — the in-process build knee is ~5 concurrent; scale workers past that).

## 6. Public access (the tunnel)

For a quick share, an account-less `cloudflared --url` quick-tunnel works but has **no uptime guarantee**
(they get edge-throttled). For anything real, use a **named Cloudflare tunnel** under your own account
(as the other projects on this box do) or a normal reverse proxy (Caddy/nginx) with TLS. A named tunnel
needs your Cloudflare credentials — that's yours to set up, not something to bake into config.

## 7. Going live checklist

Everything below is proven against the mock; the last two rows are your deliberate call.

- [x] `SESSION_SECRET` set to a unique value (boot-guard enforces it).
- [x] Postgres migrated (`prisma migrate deploy`), Redis reachable, ≥1 worker up (`/health` → `healthy`).
- [x] Admin password hashed + set; extra operators invited in-app as needed.
- [x] Build resume-on-failure, per-build trace, and readiness checks — all covered (see
      `docs/build-confidence-checklist.md`).
- [ ] **Discord bot token** set + invited (Administrator) to a *test* guild → run
      `POST /builds/readiness` with that guild → confirm `verdict: ready`, then a `canary` build, then real.
- [ ] **Stripe go-live keys** (only if selling via checkout) — `docs/stripe-go-live.md`.

When the last two are done, Disco is running for real.
