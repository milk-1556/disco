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
🚧 BLOCKED — `docker` is not installed on this build machine
What I need: nothing from you yet — just awareness. To run the full stack with one command you'll
             need Docker Desktop (or colima) on the box that hosts Disco.
Why: the `docker compose up` boot in the deliverables can't be executed here to prove it end-to-end.
What I already tried: authored infra/docker-compose.yml so it is config-valid; each service also runs
     directly via pnpm (api/worker/web on Node, Postgres/Redis are the only true container needs).
What I'm doing meanwhile: documenting both paths (docker and direct) in the README + HANDOFF, and
     wiring a tokenless/redisless demo mode so the dashboard boots without any infra.
```

---

When you're ready for the first live run, drop the token into `.env` and follow the
"First real-server test run" steps in HANDOFF.md — I'll drive it from there.
