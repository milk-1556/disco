# Disco pivot audit — what's built vs. the real mission

_2026-06-26. Written after Max clarified the real product. Grounded in a cold 3-agent classification of
the whole codebase, not memory._

## The headline correction

**Disco was never a "Discord clone" or a chat platform, and there is no clone-a-chat-app code to delete.**
The engine that already exists IS exactly the tool Max described: it maintains Discord server **templates**
and uses the **Discord Bot API** to deploy/update/back-up real Discord servers (guilds). Evidence:

- `packages/sdk/src/discord/client.ts:52-548` — a real `discord.js` v14 REST client. `CapturePort` reads a
  live guild (roles/channels/emojis/automod/content); `ApplyPort` writes them (`createRole`/`createChannel`
  /`modifyGuild`/…). This is the live Bot-API deploy mechanism.
- `packages/core/src/snapshot/capture.ts:48` — backs up a live guild into a portable template artifact.
- `packages/core/src/rebuild/execute.ts:82` — deploys a (rebranded) template into a target guild in
  dependency order, idempotent + crash-resumable.
- `packages/core/src/rebrand/transform.ts:79` — the per-creator variable transform (name/roles/brand/links).

So the answer to Step-1 Q "how much is Discord-clone code that should be deleted?" is: **~0%. None of it is
a Discord alternative.** The mistake was not in the engine — it was in the **layer built on top of it**.

## What's actually misaligned (the real finding)

The engine is wrapped in a **multi-tenant, sell-to-operators SaaS + agency-service business** that assumes
public operators and paying external clients — which directly contradicts *"Disco is for my internal use;
Max is the only user."* This wrapper (much of it added in the immediately-prior session) is the thing to
remove/re-scope:

| Subsystem | Location | Why it's wrong for a Max-only tool | Action |
|---|---|---|---|
| Multi-operator accounts | `server.ts:419` (`/operators`), `OperatorAccounts.tsx`, prisma `Operator`, `/auth/login` DB-fallback | Max is the only user — no team/white-label | **remove** |
| Owner-scoping (`ownerEmail`) | `repoScope.ts:28` + `ownerEmail` on every model, ~30 routes | Pure no-op for one admin (admin bypasses all filtering, `repoScope.ts:33`) — dead complexity + attack surface | **remove (inert, low-risk)** |
| Template marketplace | `server.ts:562-645`, Library marketplace UI, `Snapshot.shared` | Cross-operator sharing — there's only one operator | **remove** |
| Stripe sales flow | `stripe.ts:1-301`, checkout + webhook auto-create-client | Max isn't selling via Disco checkout | **remove** |
| Earnings / invoicing / MRR | `server.ts:849` (`/earnings`, `/earnings/export.csv`), `Economics.tsx`, `Job.invoicedCents/paidCents`, `Client.buildPrice/monthlyRetainer/upsells/stripeSessionId` | Service-business bookkeeping, not templating+deploy | **remove** |
| Client surveys / NPS / engagement analytics | `server.ts:816` (`/h/:id/survey`, `/surveys`, `/handovers/:id/analytics`, `/activity/client-opens`, `/share/:id`) | A court-the-paying-client funnel; Max hand-delivers to creators he already serves | **remove** |
| Public branded client delivery microsite | `PublicHandover.tsx`, `/h/:id`, `/share/:id` OG card | Agency-delivery polish; keep the useful **bot-setup + ownership-transfer report** as an internal ops view | **rescope** |
| Casino-creator marketing landing | `apps/landing/index.html` | Public sales/pricing site — an internal tool has no marketing page | **remove** |

## What carries over (generic infra)

Fastify + Prisma/Postgres + BullMQ/Redis runtime, in-memory demo mode, `/health`, audit + build-event
logs, the env-admin JWT login, rate-limiting, the web shell/nav — all **keep** (some **simplify**: drop the
`ownerEmail` columns, the webhook-log panel, and the multi-operator role gate; collapse the sell-to-clients
screens). The `resilience.ts` 429/5xx retry Proxy and `authority.ts` pre-flight audits are real deploy
safety rails — keep.

## The Discord API integration state (Step-1 Q3)

**Real and mature — build on it, don't restart.** `DiscordGuildClient` covers every resource type against
the live REST API with rate-limit + 5xx retry (`resilience.ts:48`). Prereqs already handled: bot token
(`DISCORD_BOT_TOKEN`), the Invite screen builds the bot OAuth URL with the right scopes/permissions, and a
pre-flight authority check (`/preflight/:guildId`) verifies the bot can do the job before touching a guild.

## The mission GAPS (what to build — all in the engine, not the wrapper)

1. **Push-update-to-an-already-deployed live server** (the destructive one). Today `rebuildGuild` only
   **creates**; the `ApplyPort` has **zero delete methods** (no `deleteRole`/`deleteChannel`/`deleteEmoji`),
   and reconcile has no prune action. A real "update this creator's live server from its template" needs:
   delete methods on the client, a durable **template→guild binding** (`localRef→liveId` persisted per
   deployed guild), and a **capture-live → diff-vs-template → apply-delta (create/edit/remove)** path —
   gated + adversarially reviewed, tested against a throwaway guild only.
2. **First-class Template** — today a template is just `isTemplate:boolean` on a snapshot version. Promote it
   to a named entity with its own deploy history.
3. **Creator → deployed-guilds registry** — nothing records *which* live guild(s) were deployed for a
   creator (only a per-job `targetGuildId`). Add a per-creator list of deployed servers (guildId + template +
   version) so update-and-re-backup per server is possible. (Also: no `createGuild` call — Max pre-makes each
   guild and invites the bot; the bot API *can* `POST /guilds` while in <10 guilds, a possible future add.)

## Plan

**Re-scope, not rewrite.** Phase A: remove the SaaS wrapper (low-risk — additive layers over a sound engine),
verifying the deploy engine + suite stay green after each removal. Phase B: build the mission gaps (template
as first-class, creator→guilds registry, update-diff-to-live with deletes), each adversarially reviewed and
mock-tested, `inert-by-default` for anything that would mutate a real guild until Max triggers it.
`docs/disco-real-design.md` is the target design. Rollback point: `b2bc46a`.
