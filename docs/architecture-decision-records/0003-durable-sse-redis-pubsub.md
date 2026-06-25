# ADR-0003: Durable cross-process SSE via Redis pub/sub + LIST

- Status: Accepted
- Date: 2026-06-25
- Deciders: Disco operator (autonomous build)

## Context

A Disco build is a long-running job: snapshot → rebrand → rebuild a fresh guild → deliver, sold as a $30–60k custom community. The operator watches it run via two live feeds — a per-job log tail (`/jobs/:id/logs`) and a dashboard activity ping (`/activity/stream`). Two forces make naive SSE wrong here:

1. **The producer and the SSE consumer are different processes.** In production the build runs in a separate BullMQ worker (`getQueue` in `apps/api/src/runtime.ts:22`, gated on `REDIS_URL`), while the SSE socket is held by an API process. A plain in-process `EventEmitter` in the API would never see the worker's log lines. There may also be more than one API process behind a load balancer, and a browser's SSE connection can land on any of them.
2. **A build outlives a browser tab and survives an API restart.** The operator reloads, loses Wi-Fi, or the API redeploys mid-build. On reconnect they must see the *entire* log from the start of the build with no gaps and no duplicates — not just whatever streams after they reconnect.

A bare `PUBLISH`/`SUBSCRIBE` is fire-and-forget: a subscriber that connects 200ms late, or reconnects after a redeploy, silently misses everything published before its subscription. That is unacceptable when the artifact being narrated is a five-figure deliverable.

## Decision

Both SSE endpoints speak to one `JobChannel` interface (`apps/api/src/jobChannel.ts:17`) with three operations — `publish` (durable append + live fan-out), `replay` (full history), `subscribe` (tail). Server code is identical regardless of transport; the transport is chosen once in `makeJobChannel` (`apps/api/src/runtime.ts:16-18`): `RedisJobChannel` when `REDIS_URL` is set, else the in-process `JobBus`.

**Durable Redis transport** (`apps/api/src/redisJobChannel.ts`). Each `publish` (lines 29-39):
1. `INCR disco:joblog:<id>:seq` mints a monotonic per-job sequence (line 31) and stamps it onto the event JSON.
2. `RPUSH disco:joblog:<id> <json>` appends to a durable per-job LIST — the replay buffer (line 35).
3. `EXPIRE` both keys to `LOG_TTL_SECONDS = 86400` (lines 36-37) so a 24h-old build's buffer self-cleans.
4. `PUBLISH disco:joblog:<id> <json>` fans the event out live to every subscribed API process (line 38).

**RPUSH strictly before PUBLISH** (comment at `redisJobChannel.ts:33`) is the load-bearing ordering invariant: any event that lands during a subscriber's replay/subscribe gap is still recoverable from the LIST, so it is never lost to both paths.

**The SSE endpoint hijacks the socket and reconciles replay against live.** `/jobs/:id/logs` (`apps/api/src/server.ts:935`) gates ownership *before* hijacking — a non-owner gets an opaque 404 and never reaches the stream (lines 937-939) — then `reply.hijack()` (line 941) takes the raw socket so Fastify won't also try to serialize a response, and writes `text/event-stream` headers (lines 942-954). The CORS plugin is bypassed on a raw reply, so `Access-Control-Allow-Origin` is set by hand and never reflects an arbitrary Origin (lines 949-953).

The gap-free + duplicate-free guarantee comes from ordering on the consumer side (`server.ts:1000-1007`): **subscribe FIRST, then replay.** Anything published in the window between replay and subscribe arrives live instead of being dropped; anything that appears in both replay and the live tail is collapsed by a per-connection `sent: Set<number>` keyed on `ev.seq` (lines 958, 975-978). A terminal `done`/`error` event ends the stream (line 980). Two correctness guards: teardown (`req.raw.on('close', cleanup)`) is registered **before any `await`** so a client that disconnects mid-subscribe doesn't leak a Redis subscriber connection (lines 969-971, 1003-1006); and an already-finished job short-circuits by replaying the LIST plus a synthetic terminal event so a reconnect after the TTL expired never hangs (lines 984-998).

**"Last-seen seq" reconnect** is realized by full-replay-plus-dedup rather than a client-supplied `Last-Event-ID`. The web client (`apps/web/src/api.ts:141`) cannot use native `EventSource` because it needs to send an `Authorization` header, so it streams via `fetch` + a `ReadableStream` reader. On reconnect it opens a fresh request; the server replays the whole LIST and the `seq` set dedupes — the client gets a complete, ordered, duplicate-free log every time without tracking a cursor itself.

**Activity feed rides the same bus** with zero new infrastructure (`server.ts:78-82`). A reserved channel key `__activity__` (`ACTIVITY_KEY`, line 81) carries a "something changed" ping; `pingActivity` is fired from snapshot/import/build/handover/client mutations (e.g. lines 205, 282, 869, 1126). `/activity/stream` (`server.ts:1018`) hijacks, emits an initial `open` to prompt a first load (line 1034), subscribes for pings (lines 1035-1039), and runs a 25s heartbeat comment (`: hb\n\n`, line 1041) so idle proxies don't drop the connection. The activity feed is intentionally fire-and-forget — it carries no `seq` and is excluded from the access log/metrics ring (lines 67-70) — because each ping just triggers a client refetch; durability there would be wasted.

**In-process fallback (demo mode).** With no `REDIS_URL`, `JobBus` (`jobChannel.ts:26`) backs the same interface with an `EventEmitter` plus an in-memory `history` Map and a `seqs` Map mirroring the Redis seq/LIST semantics (lines 31-50). The dashboard is fully live with zero external setup; the same server code runs unchanged.

## Consequences

**Positive**
- Reconnect-safe and redeploy-safe: the LIST replay + `seq` dedup gives a gap-free, duplicate-free log even across an API restart mid-build, which is the whole point for a five-figure deliverable.
- True cross-process and multi-API fan-out: worker-produced log lines reach any API process holding the socket, and any process can serve any client.
- One interface, two transports: identical server code in demo and prod; the in-memory `JobBus` keeps the zero-setup demo fully live.
- Free, durable activity feed: reusing the bus with a reserved key avoids standing up a second push channel.

**Negative**
- One dedicated Redis subscriber connection per open `/jobs/:id/logs` stream (`redisJobChannel.ts:48`) — a connection in subscriber mode can't issue normal commands. Many concurrent watchers means many connections; the leak-guard ordering is essential, not optional.
- Reconnect replays the *entire* LIST, O(n) in build length, rather than resuming from a cursor. Fine for human-readable build logs (bounded, short-lived); it would not scale to high-volume streams.
- `seq` dedup state lives per-connection (`sent` Set), so memory grows with the number of events seen on a single long-lived connection. Bounded by the 24h TTL and typical build length.
- The activity feed's fire-and-forget design means a ping published while no client is connected is simply missed — acceptable only because the client always does a full refetch on the next ping or on `open`.

**Neutral / foreclosed**
- We do not use native `EventSource`; auth-header support forces the `fetch`+reader client, which also means automatic browser SSE reconnection is replaced by our own connect logic.
- Replay is keyed on a Redis LIST, not the Postgres job record, so the canonical *replayable* log is ephemeral (24h TTL). Long-term log retention would need a separate persistence path.

## Alternatives considered

1. **Bare Redis `PUBLISH`/`SUBSCRIBE`, no LIST.** Simplest cross-process fan-out, but fire-and-forget: a late or reconnecting subscriber misses everything published before it subscribed, and an API restart drops the whole in-flight log. The RPUSH-before-PUBLISH LIST exists specifically to close that gap (`redisJobChannel.ts:33`). Rejected — silent log loss on a $30–60k build is the exact failure we cannot ship.

2. **Poll the Postgres job + a logs table on an interval.** No socket hijacking, naturally durable, survives everything. But it adds latency (the operator wants the build narrated live), hammers the DB per watcher, and requires a write-amplified per-line logs table. The activity feed already proves event-driven beats polling (`server.ts:80`). Rejected as both laggy and heavier.

3. **A dedicated push service (WebSocket gateway / Server-Sent-Events broker, e.g. Centrifugo / Pusher).** Purpose-built fan-out with built-in history and presence. But it is a whole new component to run, secure, and reason about, when Redis is already a hard dependency for BullMQ (`packages/core/src/queue.ts:21`). Reusing Redis for both the queue and the log/activity bus keeps the moving-part count minimal for a single-operator platform. Rejected as over-infra for the scale.
