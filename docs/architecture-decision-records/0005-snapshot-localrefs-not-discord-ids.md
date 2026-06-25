# ADR-0005: Snapshots use internal localRefs, never raw Discord snowflake ids

- Status: Accepted
- Date: 2026-06-25
- Deciders: Disco operator (autonomous build)

## Context

Disco sells $30–60k custom Discord community builds. The platform snapshots a
proven template server, rebrands it per client, and rebuilds it into a *fresh,
different* guild for delivery. The same snapshot is rebuilt many times into many
target guilds, and a single rebuild must be resumable after a crash without
producing duplicates.

A captured server is a graph of cross-references, not a flat list: a channel
points at its parent category; a permission overwrite targets a role; an automod
rule exempts roles and channels and alerts to a channel; guild settings point at
afk/system/rules/welcome channels; message bodies embed `<#channel>` and
`<:emoji:id>` mentions. In the *source* guild every one of those pointers is a
Discord snowflake (`/^\d{15,21}$/`, see `packages/schema/src/primitives.ts:17`).

Those snowflakes are guild-local. The moment we rebuild into a different guild,
Discord mints brand-new ids for every role/channel/emoji. A snapshot that stored
raw source snowflakes in its cross-references would be **dangling on arrival** —
every overwrite, parent pointer, and mention would point at an object that does
not exist in the target. The artifact has to be portable across unlimited target
guilds and rebuildable idempotently, which is impossible if its internal edges
are tied to one guild's id space.

## Decision

Inside a snapshot, every object is identified by an internal **`LocalRef`**
(`packages/schema/src/primitives.ts:13`, a `string().min(1).max(190)` shaped
`<kind>_<slug>` e.g. `role_admins`, `chan_welcome`), and **every cross-reference
is a localRef, never a snowflake**. The raw snowflake is kept only as a
`sourceId`/`targetSourceId` field for traceability — it is never used as an edge.

Capture allocates refs and rewrites all edges in one pass
(`packages/core/src/snapshot/capture.ts:48`):

- A `RefAllocator` (`packages/core/src/snapshot/refs.ts:1`) hands out
  collision-free `<prefix>_<slug>` refs, slugging the object name and appending a
  numeric suffix on collision (`refs.ts:5–17`). `@everyone` is pinned to the
  stable `role_everyone` (`capture.ts:57`).
- Capture builds id→ref lookup maps as it goes: `roleIdToRef`,
  `emojiIdToRef`, `channelIdToRef`, `categoryIdToRef`
  (`capture.ts:54,77,107,108`).
- Every cross-reference is then translated through those maps:
  - permission overwrites → `targetRef` (+ `targetSourceId` kept for trace),
    `capture.ts:112–120`;
  - channel → parent via `categoryRef`, `capture.ts:141`;
  - emoji allow-list → `roleRefs`, `capture.ts:88`;
  - forum tag / default-reaction emoji → `emojiRef`, `capture.ts:155,158`;
  - automod → `alertChannelRef`, `exemptRoleRefs`, `exemptChannelRefs`,
    `capture.ts:183,187,188`;
  - guild pointers → `afkChannelRef` / `systemChannelRef` / `rulesChannelRef` /
    `publicUpdatesChannelRef` and welcome-screen `channelRef`/`emojiRef`,
    `capture.ts:256–275`;
  - message bodies → `mentionsToRefs` rewrites `<#id>` and `<:name:id>` into
    `<#ref>` / `<:name:ref>` so mentions survive into a new guild
    (`refs.ts:24–38`, called at `capture.ts:224`).

At build time the indirection is resolved in the opposite direction. The job
manifest is the localRef→newId source of truth: as each object is created in the
target guild its assigned snowflake is recorded against its localRef
(`commitEntry`, `packages/core/src/rebuild/manifest.ts:81`), and `buildIdMap`
materializes the `Record<localRef, Snowflake>` (`manifest.ts:91–95`). Rebuild
feeds that map back into `mentionsToIds` to rewrite message refs to real ids
(`packages/core/src/rebuild/execute.ts:412–423`), and pins `role_everyone` to the
target guild's everyone id (`execute.ts:217`). Because the manifest persists,
matching is *prior entry by ref → existing target object by kind+name → create*
(`reconcile`, `manifest.ts:40–78`), so a half-finished build resumes without
duplicating and a re-run updates in place.

## Consequences

Positive:

- One snapshot is portable to unlimited target guilds — no edge is tied to the
  source guild's id space.
- Idempotent, resumable rebuilds: localRefs are the stable join key across runs
  even though snowflakes differ every time (`manifest.ts:40–95`).
- Capture is pure w.r.t. Discord (all I/O via `CapturePort`), so it runs
  identically against `MockGuild` and the live client, and validates against the
  schema before returning (`capture.ts:295`).

Negative / tradeoffs:

- Two-phase indirection adds machinery: capture must build and thread four id→ref
  maps, and rebuild must persist and replay the manifest. A direct copy would be
  simpler.
- Refs are name-derived slugs, so capture order and naming affect ref identity;
  renaming the source between captures yields a different ref and is treated as a
  new object by reconcile's kind+name matching.
- Mention rewriting is regex-based (`refs.ts:20,21`) and only covers channel and
  emoji mentions; role/user mentions in message bodies are out of scope.

Neutral:

- Source snowflakes are still retained (`sourceId`, `targetSourceId`) for audit
  and debugging — they are dead weight at build time but cheap and useful.
- Edges that can't be resolved degrade gracefully: unknown overwrite targets fall
  back to `role_unknown_<id>` / `member_<id>` (`capture.ts:117,118`) and
  unresolved mentions are left as-is rather than dropped (`refs.ts:31–36`).

## Alternatives considered

1. **Store raw source snowflakes in cross-references.** Rejected: snowflakes are
   guild-local. On rebuild into a different guild every edge would dangle, since
   the target mints all-new ids. This defeats the core requirement that one
   snapshot rebuild into many fresh guilds.

2. **Resolve everything to target ids in a single capture→build pass (no
   intermediate ref layer).** Rejected: it couples a snapshot to one specific
   target guild, so it can't be re-delivered to other clients, can't be inspected
   or rebranded as a standalone artifact, and can't be schema-validated
   independently of a live build (`capture.ts:295`).

3. **Use array indices or insertion order as implicit references.** Rejected:
   indices are brittle under edits/merges and unreadable in the persisted
   artifact and manifest. Named `<kind>_<slug>` refs are stable across reorders,
   human-auditable in logs and the manifest, and survive snapshot merges where a
   positional scheme would silently misalign edges.
