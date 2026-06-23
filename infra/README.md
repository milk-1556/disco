# Disco infra

## Run the whole stack

```bash
cp .env.example .env          # optional — sensible demo defaults are baked in
docker compose -f infra/docker-compose.yml up --build
```

Services:

| service  | port | notes |
| -------- | ---- | ----- |
| web      | 5173 | the dashboard (served from the production build) |
| api      | 4000 | REST + SSE; boots in DEMO mode without a token |
| worker   | —    | BullMQ build worker (consumes `disco:builds`) |
| postgres | 5432 | persistence (Prisma) |
| redis    | 6379 | job queue |

Open http://localhost:5173 and sign in with `operator@disco.local` / `disco` (demo).

## Demo vs live

- **Demo (default):** no token. The API/worker build into an in-memory MockGuild. Every screen,
  the dry-run, the report, and the queue work — nothing touches Discord.
- **Live:** set `DISCORD_BOT_TOKEN` (+ `DISCORD_APPLICATION_ID`) in `.env`, then capture from a real
  source guild and build into a real target guild. See `HANDOFF.md` for the safe first-run steps.

## Without Docker

Every service also runs directly on Node 20 (Postgres/Redis are the only true container needs, and
only in live/persistent mode — demo mode needs neither):

```bash
pnpm install
pnpm --filter @disco/api start      # :4000  (demo mode, in-memory)
pnpm --filter @disco/web dev        # :5173  (proxies /api → :4000)
pnpm --filter @disco/worker start   # needs REDIS_URL
```

## Production persistence

The API ships with an in-memory `Repo` (zero-setup demo). For a durable, multi-process deployment,
apply the Prisma schema and point the API/worker at Postgres:

```bash
pnpm --filter @disco/api exec prisma migrate deploy
```

(The Prisma-backed `Repo` implementation drops in behind the existing interface in
`apps/api/src/repo.ts` — see `HANDOFF.md` → "Remaining wire-up".)
