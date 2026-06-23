# Blockers — items awaiting an operator decision

These are the few hard gates from the brief (§ AGENT OPERATING MODE). Everything else is being
built and verified against the MockGuild + fixtures. None of these block further engine/app/UI work
— they only gate *live* Discord activity and the full dockerized boot.

---

```
🚧 BLOCKED — first live Discord run needs a real bot token + target guild
What I need: DISCORD_BOT_TOKEN (+ DISCORD_APPLICATION_ID) for a bot with Administrator and the
             privileged intents enabled, and a throwaway TEST guild id for the first capture/build.
Why: capture/build write to / read from real Discord; per the brief, the first real-server run is
     operator-triggered, knowingly — never auto-run against a handed-over production guild id.
What I already tried: built the entire pipeline against an in-memory MockGuild + fixtures; the real
     discord.js v14 client (packages/sdk/src/discord/client.ts) typechecks against the library's own
     types so the REST routes/signatures are verified to exist — it just hasn't been pointed at a
     live token.
What I'm doing meanwhile: continuing with the API, worker, dashboard, infra, and docs, all runnable
     in MockGuild "demo mode" with no token.
```

```
🚧 NOTE (not blocking) — `docker` is not installed on this build machine
What I need: nothing from you — just run ONE command on a box with Docker to boot the whole stack:
     docker compose -f infra/docker-compose.yml up --build
Why: I couldn't execute `docker compose up` here to prove the containerized boot end-to-end.
What I already did INSTEAD: installed native Postgres 16 + Redis via brew and verified the FULL
     production path locally — API enqueues → BullMQ(Redis) → separate worker process executes via
     @disco/core → writes results to Postgres(Prisma) → API reads back, with cross-process SSE logs.
     This is covered by an automated integration test (apps/api test:integration, 3/3 passing against
     real Postgres+Redis) AND a manual two-process run. So the wiring is proven; only the docker
     packaging of it is unverified-here.
What's authored: infra/docker-compose.yml (web/api/worker/postgres/redis + a one-shot `migrate`
     service the api/worker wait on) + per-service Dockerfiles. Each service also runs directly via
     pnpm; the tokenless/dbless/redisless demo still boots with zero infra.
```

---

When you're ready for the first live run, drop the token into `.env` and follow the
"First real-server test run" steps in HANDOFF.md — I'll drive it from there.
