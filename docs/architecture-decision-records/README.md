# Architecture Decision Records

Short, durable notes on the **why** behind Disco's load-bearing design choices — so a future engineer
(or future-you) can understand a decision in two minutes instead of reverse-engineering it from the code.
Each ADR follows the standard shape: **Context → Decision → Consequences → Alternatives considered**, with
`file:line` anchors to the real implementation.

| # | Decision | One-line why |
|---|---|---|
| [0001](0001-multi-operator-idor-scoping.md) | Owner-scoping as a single IDOR chokepoint | `scopeRepo(base, actor)` makes multi-operator isolation correct-by-construction, not per-route discipline. |
| [0002](0002-jwt-boot-guard-demo-mode.md) | Stateless JWT + tokenless demo-mode boot guard | Boots zero-setup for the demo; `assertSecureEnv` hard-crashes a production deploy still on the dev secret. |
| [0003](0003-durable-sse-redis-pubsub.md) | Durable cross-process SSE via Redis pub/sub + LIST | Sequenced, replayable, multi-process live logs/activity with no new infra beyond Redis; in-memory fallback for demo. |
| [0004](0004-repo-interface-inmemory-prisma.md) | One `Repo` port, InMemory + Prisma adapters | Business logic depends on an interface, not Postgres; demo runs in memory, prod is a drop-in chosen by `DATABASE_URL`. |
| [0005](0005-snapshot-localrefs-not-discord-ids.md) | Snapshots use internal `LocalRef`s, never raw snowflakes | A snapshot must rebuild into a *different* guild, so every cross-reference is an internal ref remapped at build time. |
| [0006](0006-snapshot-composability-merge.md) | Merge two snapshots by name + generic ref-remap | Name-matched union with a/b conflict resolution; a generic `deepRemap` keeps the merged graph self-consistent. |

New ADRs are numbered sequentially. Write one when a choice is hard to reverse, surprising, or would
otherwise be re-litigated — not for routine code. Status stays `Accepted` unless a later ADR supersedes it
(note the supersession in both).
