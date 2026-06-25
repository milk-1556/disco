# Handover Best Practices

*The operator's guide to delivering a $30–60k Discord build so the client is delighted — and the upsells follow.*

This is the part of the job Disco can't do for you. The engine snapshots, rebrands, and rebuilds a
server in dependency-correct order, idempotently, with an honest punch-list of everything Discord's API
can't clone. But the *delivery* — how you frame what you built, how you set expectations, how you hand
over the keys, how you stay in the deal after the build fee clears — that's craft. Done well, the
handover is the single biggest driver of "delighted client → monthly retainer → seasonal redesign." Done
sloppily, you leave a non-technical creator staring at a half-configured bot, blaming you for a Discord
limitation, and never replying to your next message.

Treat this document as the moat. Anyone can spin up channels. The reason a creator pays you $40k and
keeps paying is that the experience *feels finished and feels handled*. Everything below is in your
voice, grounded in what Disco actually produces on the delivery page (`PublicHandover` /
`ManagingGuide`) and in the rebuild report's manual steps.

---

## 1. The welcome message

The welcome message is the first thing the client reads on the public delivery page (`/h/:id`). It sits
in its own panel above the "what's included" scope grid. It is short, warm, and load-bearing — it sets
the entire emotional tone of the handover. Write it *to the creator*, not about the build.

A good welcome message does four jobs in four or five sentences:

1. **Warm intro** — congratulate them, make it feel like an arrival, not a file transfer.
2. **What was built** — one line naming the shape of what they're getting (don't list everything;
   the scope grid does that right below).
3. **Where to start** — point them at the one or two things to do first so they're not paralyzed.
4. **How to reach you** — make it trivially easy to reply. The page footer already tells them to reply
   to the delivering message; reinforce it.

Keep it under ~90 words. It renders in a single panel; a wall of text kills the premium feel. Use their
brand name, not "your server."

### Template A — slots / casino creator

```
Welcome to the new Spinhaus HQ — your community is built and ready to open the doors.

Everything's in place: your channels for drops, bonus calls, and chat; the VIP and
high-roller roles; and the giveaway and stream-alert bots wired in. Start in #start-here
to claim your roles, then drop your first bonus code in #bonus-drops to wake the room up.

A couple of bots need a quick re-invite from you — the checklist below walks you through
each one in about five minutes. Stuck on anything? Just reply to this message and I'll
jump in.
```

### Template B — IRL / travel streamer

```
Welcome home, Maya — your community hub is live and waiting for the crew.

I've set up channels for trip planning, live-location pings, clip drops, and a members-only
lounge, with roles so your regulars and subs feel like the inner circle. Hop into #welcome
first to grab your roles, then post in #next-destination to get the chat dreaming with you.

The bots that run your level-up perks and clip reposts just need a one-click re-invite from
you — the guide below has the links. Anything looks off? Reply here and I'll sort it fast.
```

### Template C — sponsor / affiliate-driven server

```
Welcome to the new Apex Partners server — your sponsor home base is ready to go.

It's built around the deals: dedicated channels for each campaign, an affiliates category,
clean roles separating partners, mods, and members, plus the bots that gate access and post
your tracked links. Start in #partner-onboarding, then check #campaigns to see the deal
structure laid out.

One housekeeping step: re-invite the access-and-payments bot using the link below so the
gated roles go live again. Five minutes, fully guided. Questions on any of it — reply here
and I'll walk you through it.
```

> **Voice notes.** Always name a *first action* tied to a real channel you built. Always mention the
> bot re-invite *positively* ("a quick step," "fully guided") so it reads as service, not a missing
> piece. Never apologize for the manual steps — see §3.

---

## 2. The management guide ("Managing your community")

This is the collapsible **"Managing your community"** section on the delivery page (`ManagingGuide`).
It's generated from the build report, but you should understand exactly what it tells the client so you
can reinforce it in your handover call or DM. It's written for a creator with zero technical background.
It covers four things, and you should be ready to expand on each one verbally.

### Channels & categories
The guide tells them how many channels they have and that categories are "the labeled groups in your
sidebar that keep related channels together." When you talk them through it, frame channels as *rooms*
and categories as *floors*. The instinct you want to instill: don't delete things you don't understand,
and ask before restructuring — that's a retainer conversation waiting to happen.

### Roles & permissions
The guide explains roles as "the badges you give members (like Mod or VIP) — they decide who can see and
do what." The one concept a non-technical creator must internalize: **permissions cascade by role, not
by person.** They give someone a role, not a list of toggles. Tell them the order of roles in the list
is the hierarchy (higher = more authority) and warn them gently that dragging roles around is how people
accidentally lock themselves out. This is the #1 self-inflicted wound; flagging it makes you look like
the expert and pre-sells management.

### The bots they must re-invite (and why some settings can't be cloned)
This is the part that surprises clients, so own it before they're confused. Disco copies the *structure*
of a server — channels, roles, permissions, emojis, the visible layout of bot-driven panels. It cannot
copy a third-party bot's **configuration**, because that config lives on the bot vendor's own servers
(Carl, MEE6, Tickets, etc.), not inside the Discord guild. There is no API that hands it over.

So every detected bot shows up on the delivery page under **"bots to add"** with:
- a **one-click OAuth re-invite URL** pre-loaded with the permissions that bot typically needs (you
  don't have to hand-pick anything — `botSetup.ts` bakes in a sane management permission set), and
- concrete **reconfigure steps** for the features that went inert — e.g. *"Recreate the reaction-role
  panels — they were copied visually but stay inert until this bot owns them again,"* *"Re-set the
  welcome message and channel,"* *"Reconnect the paid-membership products and gated roles."*

Tell the client plainly: *"The rooms and the décor came with the house; the smart-home app has to be
re-paired to your account. Click, approve, done."* That framing turns a limitation into a two-minute
chore.

### Keeping it healthy
The guide surfaces the build's manual steps as friendly "do this" items. Reinforce the habit, not the
panic: members and roles connect *after people join* (a fresh guild has no members yet), interactive
panels light up once their bot is re-paired, and anything boost-locked appears as they boost. Tell them
the server is a living thing — a quick monthly look keeps it sharp. (That's the retainer pitch, said
softly.)

---

## 3. Setting client expectations

The honest punch-list is your competitive advantage, not your apology. Disco's entire philosophy —
baked into the rebuild engine — is **"surfaced honestly, never silently skipped."** Lean into it. A
client who's told upfront *"these three things need a human, here's exactly how"* trusts you far more
than one who discovers a dead button next week.

### What Disco does vs. what needs a human

| Disco does automatically | Needs a human (and why) |
| --- | --- |
| Channels, categories, the full layout | **Bot reconfiguration** — settings live on the vendor's servers; no API can copy them |
| Roles, permission overwrites, hierarchy | **Member→role assignments** — there are no members in a fresh guild yet |
| Emojis & stickers (within slot limits) | **Interactive panels** (reaction-role / button / ticket) — copied *visually*, but inert until the owning bot is reconfigured |
| AutoMod rules, guild settings, welcome screen | **Boost-locked features** — banner, role icons, vanity URL, extra emoji slots; these "skip" until the server reaches the required boost tier |
| The content of info/rules channels | **Ownership transfer** — Discord requires the new owner to have 2FA enabled first |
| A `⟜ Disco Build` marker role (temporary) | **Discovery / monetization** — gated behind Discord's own review |

### The boost-tier "skip," explained
This is the one that looks like a bug if you don't pre-empt it. When the engine builds into a *fresh,
unboosted* guild, Discord legitimately rejects items that the target's boost tier can't support — a
banner (needs tier 2), an invite splash (needs tier 1), role icons, stickers, emoji beyond the free
slots. The engine **does not abort** on these; it records each one as a *skipped* item with a plain-
English reason (e.g. *"this asset needs a higher boost tier on the target guild,"* *"the guild is out of
emoji slots — raise the boost tier"*) and keeps building. The pre-flight feasibility audit warns you
about these *before* you build, and the target tier selector in the Build Console lets you model it.

Frame it for the client as a feature of *their* growth: *"Your banner and role icons are staged and
ready — the moment your community hits boost level 2, they appear automatically. Nothing to redo."*
That's a reason for them to push boosts (good for the server) and a natural seasonal check-in for you.

### Framing the punch-list as a feature, not a gap
On the operator handover page the manual steps carry the tagline **"surfaced honestly — never silently
skipped."** Use that exact spirit with the client. Three moves:

1. **Pre-announce it.** In your welcome message and your call: "There's a short, guided punch-list — I
   could have hidden it, but I'd rather you know exactly what's yours to finish in five minutes."
2. **Make it look small.** It *is* small — usually a couple of bot re-invites. The delivery page already
   numbers and links each one. Walk through the first one with them so the rest feel trivial.
3. **Position it as protection.** "Everything Discord *can* automate, I automated. The few things it
   can't, I'm telling you about rather than letting you find a dead button later." Honesty reads as
   competence.

---

## 4. The ownership handoff

Every delivery moves through three states, shown as a chip on the operator handover page and gating what
the client can see:

```
draft ──► ready ──► handed_over
```

- **draft** — the working record. The build report, scope, bot checklist, and ownership checklist are
  assembled here. The public `/h/:id` link **404s while a handover is in draft** — clients can't stumble
  onto an unfinished page. Polish the welcome message, upload the client's logo, and set a password here.
- **ready** — you've reviewed it and it's client-facing. Hit **"Mark ready to hand over →."** The public
  link now resolves. Send it.
- **handed_over** — you've confirmed the transfer is complete. Hit **"Confirm hand-over ✓."** This is
  your "deal delivered" marker and the anchor for follow-up timing (§5).

### The public `/h` link
The shareable, client-facing page lives at `/h/:id`. Share it via the `/share/:id` link from the
**Branding & sharing** panel — that URL carries social-preview meta (og:title etc.), so it unfurls into
a branded card when you drop it in Discord, email, or a DM. Optionally password-gate it; the client gets
a clean "this handover is password-protected" unlock screen, and the password is never returned to the
client UI.

### Transferring server ownership (the 2FA gate)
Discord only lets a server **owner** transfer ownership to a member who has **2FA enabled**. That
constraint drives the whole flow, which is seeded as the default Ownership Transfer Checklist on every
handover (`defaultOwnershipSteps`):

```
01  Client joins the server (send the invite; confirm they're in)
02  Client enables 2FA on their Discord account   ← required by Discord before transfer
03  Grant the client a temporary Admin role        (so they can operate during handover)
04  Transfer ownership: Server Settings → Members → ⋯ → Transfer Ownership
05  Client re-invites & configures the third-party bots (work the Bot Setup Checklist)
06  Remove Disco's bot and your operator role      (clean exit once verified)
```

Tick each step off on the operator page as you go (the chip shows `n/m`). **Step 02 is the one clients
forget** — tell them to enable 2FA *before* your call so you're not waiting on it live. If they balk at
2FA, explain it's a Discord requirement that protects *their* server, not a Disco quirk.

### The `⟜ Disco Build` marker role
Live builds stamp a temporary **`⟜ Disco Build`** role on the server. It carries **no permissions** and
exists only so anyone can see, at a glance, who built the server. It is **safe to delete** once ownership
has transferred — and the engine reminds you to: a manual step *"Remove the '⟜ Disco Build' role after
handover"* is appended to every live report. Removing it (and your operator role, step 06) is the clean
exit that makes the server feel 100% *theirs*. Don't skip it — a leftover builder role is a small
blemish on an otherwise pristine handover.

---

## 5. Follow-up & upsells

The handover page tracks **client engagement** — origin and timestamp only, never identity, never an IP.
Use it to *time* your touch, not to surveil. The signals you get:

- **Opened N×** (with "last seen" relative time)
- **Read docs N×** (they expanded the Managing-your-community guide)
- **Downloaded report N×**
- a small recent-activity timeline

### Timing the check-in off real signals
- **Opened 3×, read the docs** → they're engaged and learning. This is the *perfect* moment for a
  warm check-in: *"Saw you've been getting into the new server — want me to walk you through the role
  setup live?"* Reference their interest, never the tracking.
- **Opened once, then nothing** → they peeked and bounced. Nudge gently with the *first action* from
  their welcome message: *"Did you get a chance to drop your first bonus code in #bonus-drops?"*
- **Not opened yet** (the page literally shows "○ Not opened yet") → don't pitch. Re-send the link with
  a one-liner: *"Here's your delivery page — everything's ready whenever you are."*
- **Downloaded the report** → they're sharing it internally or with a partner. Treat it as a buying
  signal for the *retainer* — someone's evaluating the work.

A clean cadence: confirm hand-over → wait for the *first open* → check in within 24h of that open →
follow up again at ~2 weeks once they've lived in it.

### What to upsell, and when
Mark the outcome on the handover's **upsell tracker** (`none → proposed → retained → redesign`) so the
Economics view rolls it into MRR/ARR and you never lose track of where a client sits.

- **Monthly management retainer** — the core upsell. Pitch it the moment they hit their first "I don't
  know how to do X" (roles, a new channel, a moderation rule). The management guide deliberately plants
  the seed: *"Want a hand keeping it growing? Your builder can help — just reply."* Price it as peace of
  mind: you keep the server healthy, current, and bot-configs from drifting.
- **Seasonal / event redesigns** — a fresh look for a tournament, a holiday, a sponsor launch, a rebrand.
  This is where snapshots pay off: you reskin from a template in a few clicks, so the redesign is high-
  margin. Time these to *their* calendar — a slots creator before a big tournament, a sponsor server at
  campaign launch. The boost-tier "staged features" (§3) are a natural reason to circle back: *"You hit
  boost level 2 — want me to switch on the banner and role icons we staged?"*
- **Emoji / sticker packs** — small, fast, delightful, and a low-friction first upsell that proves the
  retainer is worth it. Bundle a branded set tied to a season or a meme the community runs with.

The throughline: every upsell is *continuity of care*. You built it, you know it, you're the one who
keeps it excellent. The handover done right makes that the obvious choice — which is the whole point.

---

*Delivered with Disco.*
