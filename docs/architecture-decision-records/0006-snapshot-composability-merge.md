# ADR-0006: Snapshot composability — merging two snapshots by name with generic ref-remapping

- Status: Accepted
- Date: 2026-06-25
- Deciders: Disco operator (autonomous build)

## Context

A Disco engagement sells a $30–60k custom Discord community build: snapshot a template
server, rebrand it per client, rebuild into a fresh guild. Over many builds the operator
accumulates a library of proven server snapshots — a "gaming community" base, a "creator
membership" overlay, a "support desk" overlay. The natural next sale is *compose* these:
take base server A and layer overlay B on top to produce one composite snapshot, rather than
rebuilding each archetype from scratch.

The hard part is that a snapshot is not a flat list — it is a *reference graph*. Channels
point at categories (`categoryRef`), permission overwrites point at roles (`targetRef`),
emojis gate on roles (`roleRefs`), automod rules exempt roles/channels
(`exemptRoleRefs`/`exemptChannelRefs`), content lives under a `channelRef`, and bot
config-traces carry a lowercase `ref` into the snapshot (`packages/core/src/compose.ts:31-34`,
`:86-93`, `:44-49` in the test). Every object is identified internally by a string `localRef`.
If you naively concatenate A and B, two independently-authored snapshots will have colliding
`localRef` namespaces and B's references will resolve to A's objects (or nothing), corrupting
the graph. Merging must keep the composite graph self-consistent and re-validate it against
the `Snapshot` schema before it can be rebuilt.

## Decision

Implement composition as a single pure function `mergeSnapshots(a, b, resolutions)`
(`packages/core/src/compose.ts:42-101`) returning `{ snapshot, conflicts }`.

**Match objects by NAME, per collection.** For each of the six mergeable kinds
(`roles, categories, channels, emojis, stickers, automod` — `compose.ts:20`) we build an
A-side name index `aByName` (`:52`) and walk B. The result is the union: A-only objects pass
through unchanged (`:70-77`, default "A wins"), B-only objects are appended (`:79-81`).

**Name collisions are surfaced, not silently merged.** A name present in both is pushed onto
`conflicts` as `{ kind, name }` (`:56`) and the operator resolves it via
`resolutions["${kind}:${name}"]` = `'a' | 'b'` (`:14`, `:72`). `'a'` keeps A's object; `'b'`
takes B's content but **under A's `localRef`** (`deepRemap({ ...bObj, localRef: aObj.localRef }, rr)`,
`:74`) so any A-side reference to that object still resolves. Either way exactly one object of
that name survives (asserted at `compose.test.ts:62-63`).

**A generic `deepRemap` rewrites the reference graph.** B's `localRef`s are remapped through
`bRemap` (`:46`): a collision points B's ref at A's existing ref (`:57`, so B's references fold
into A's object); a B-only object gets a collision-proof `m_`-prefixed ref (`:59`). `deepRemap`
(`:25-40`) then walks every B-side object and rewrites, by *convention not enumeration*: any
key ending in `Refs` that holds an array (`:31`), any key ending in `Ref` (`:34`), **and** the
bare lowercase `ref` that bot config-traces use (`:34`, a real LocalRef despite its name). The
object's own `localRef` is copied verbatim and explicitly excluded from remapping (`:30`) —
identity is preserved while every outbound reference is rewritten. A's own refs are absent from
`bRemap`, so the identity lookup `rr` returns them unchanged (`:64`).

Content and bots follow the same union-by-name rule: A's content is kept as-is, B-only
channels' content is carried with `channelRef` remapped (`:86-94`); bots union by name with
guild settings / brandTokens / source staying with A as the base (`:96-98`). Finally the whole
composite is re-parsed: `Snapshot.parse(merged)` (`:100`) — an invalid graph throws rather than
shipping. The test asserts every cross-reference in the composite resolves to a real `localRef`
(`compose.test.ts:28-50`), including the bot-trace `ref` seam (`:44-49`).

## Consequences

Positive:
- Composition is a pure, deterministic, idempotent function over two validated snapshots — no
  Discord API, no live guild, fully unit-testable (`compose.test.ts`).
- `deepRemap` is convention-driven, so adding a new `*Ref`/`*Refs` field to the schema needs
  **zero** changes here — the remapper covers it automatically. This is the main reason it is
  generic rather than a hand-written per-field rewrite that would silently miss new fields.
- The result is re-validated, so a structurally broken merge fails loudly at compose time, not
  mid-rebuild against a client's live guild.

Negative / tradeoffs:
- **Name is the identity.** Two semantically different roles that happen to share a name
  (`"Member"`) are treated as the same object and collapsed/conflicted; conversely renaming an
  object in B breaks the intended match. The operator must curate consistent naming across the
  library.
- The `'b'` resolution merges B's content into A's `localRef` but does **not** rename A's object
  to B's name (they share a name by definition) — it cannot reconcile *partial* differences
  (e.g. keep A's color but B's permissions); resolution is all-or-nothing per object.
- `deepRemap`'s convention is a heuristic: it assumes every `*Ref`/`*Refs`/`ref` string is a
  LocalRef. A future field that ends in `Ref` but holds something else (a URL, a Discord
  snowflake) would be wrongly remapped. The lowercase-`ref` special-case (`:34`) is exactly such
  a latent footgun already paid down once.
- Guild-level settings, brandTokens and source are hard-wired to A (`:96`). You cannot compose
  two *brandings*; B contributes only structure, never identity.

Neutral:
- Only the six enumerated kinds plus content and bots merge; anything else on the snapshot is
  inherited from A via the `{ ...a }` spread (`:66`).

## Alternatives considered

1. **Match by `localRef` (id) instead of name.** Rejected: `localRef`s are authored
   independently per snapshot, so they carry no cross-snapshot meaning — id-matching would
   either never match (random collisions) or require a manual id-mapping table the operator
   would have to maintain by hand. Name is the only identifier a human reasons about when
   curating a snapshot library, and it is what the operator actually wants to dedupe on.

2. **Per-field explicit remapping** (enumerate `categoryRef`, `targetRef`, `roleRefs`, … by
   hand). Rejected: it duplicates schema knowledge in the merger and silently rots — a new ref
   field added to the schema would pass through un-remapped and corrupt the graph with no test
   failure until a rebuild breaks. `deepRemap`'s `endsWith('Ref')` convention (`:31-34`) is the
   cheaper, future-proof contract.

3. **Auto-pick a winner on collisions** (last-write-wins, or always-B). Rejected: at $30–60k a
   build, silently dropping A's "Admin" role for B's is unacceptable. Surfacing every collision
   as a `MergeConflict` for explicit operator resolution (`:56`, `:14`) keeps the human in the
   loop on exactly the decisions that carry product risk, while still defaulting to a safe "A
   wins" when no resolution is given (`:70-77`).
