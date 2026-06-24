# Stripe go-live — the 5-minute paste

This is the operator's guide to switching Disco's Stripe sales flow from **scaffold mode** (no
keys, fully testable) to **live mode** (real Checkout Sessions, real webhooks). Everything here is
confirmed against the code in `apps/api/src/stripe.ts` and `apps/api/src/env.ts` — no invented
fields, no fake endpoints.

> Honesty note: live Checkout-session **creation** is still a documented TODO in the scaffold —
> `POST /stripe/checkout` returns `501` once `STRIPE_SECRET_KEY` is set until the official SDK is
> wired in (see [Two modes](#two-modes) below). The **webhook** path, however, is fully live: set
> `STRIPE_WEBHOOK_SECRET` and real `checkout.session.completed` events verify and fulfil today.

---

## Env vars (exact names)

Both are read directly from `process.env` in `apps/api/src/stripe.ts`. Neither is surfaced through
`env.ts` — there are **no defaults**; absence is what triggers scaffold mode.

| Variable | Read at | Effect |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | `/stripe/checkout` (`process.env.STRIPE_SECRET_KEY`) | **Unset** → scaffold session returned. **Set** → live branch (currently `501`, SDK is TODO). |
| `STRIPE_WEBHOOK_SECRET` | `/stripe/webhook` (`process.env.STRIPE_WEBHOOK_SECRET`) | **Unset** → events accepted **unverified** (scaffold). **Set** → signature verified against the raw body; bad signature → `400`. |

Related env it leans on (from `env.ts`, used by the live-mode TODO block in `checkout`):

- `WEB_ORIGIN` — base for `success_url` / `cancel_url` when you wire the live SDK. Defaults to `*`,
  so set a real origin before going live.

---

## The two routes

Registered by `registerStripeRoutes(app, repo)`:

- `POST /stripe/checkout` — **auth required** (`Bearer` session token). Creates a Checkout Session
  for a client purchase.
- `POST /stripe/webhook` — **no auth**. Stripe → us. Verifies the signature, then fulfils.

The deployed webhook URL is your API origin + `/stripe/webhook`, e.g.
`https://api.yourdomain.com/stripe/webhook`.

---

## Two modes

### Scaffold mode (no keys) — the default

- `POST /stripe/checkout` returns a deterministic fake:
  ```json
  {
    "url": "https://checkout.stripe.com/pay/SCAFFOLD",
    "mode": "scaffold",
    "note": "set STRIPE_SECRET_KEY to create real sessions",
    "lineItems": [{ "name": "Disco rebrand — <clientName>", "amount": <price|0>, "quantity": 1 }]
  }
  ```
- `POST /stripe/webhook` skips signature verification entirely and accepts the event, so you can
  POST a fake `checkout.session.completed` body locally and watch a client get auto-created.

### Live mode (keys set)

- `STRIPE_SECRET_KEY` set → `checkout` takes the live branch. **Today that branch returns
  `501 { "error": "live Stripe not implemented in scaffold", "mode": "live" }`** — the real
  `stripe.checkout.sessions.create(...)` call is commented TODO in the file. Wire the SDK there
  before flipping this key in production.
- `STRIPE_WEBHOOK_SECRET` set → `webhook` verifies the `stripe-signature` header (`t=…,v1=…`,
  HMAC-SHA256 over `${timestamp}.${rawBody}`) and rejects mismatches with `400`. This path is fully
  functional now.

---

## What the webhook consumes (fulfilment)

The webhook only acts on event type **`checkout.session.completed`**. It reads
`event.data.object.metadata` and uses exactly these fields:

| Metadata field | Used for | Required? |
| --- | --- | --- |
| `clientName` | `repo.addClient({ creatorName: clientName })` — trimmed; **if empty, nothing is created** | Yes |
| `handle` | `repo.addClient({ handle })` — falls back to `''` | No |
| `rebrandConfig` | carried for the build kick (documented TODO; parsed as JSON when the build is wired) | No |

It also reads `session.id` for the auto-created client's note
(`Auto-created from paid Stripe checkout (session <id>)`).

Auto-created client defaults (from code): `brandColors: []`, `links: []`, `assets: {}`,
`termSwaps: []`, `buildPrice: 0`, `monthlyRetainer: 0`, `upsells: []`. The build job is **not** kicked
in the scaffold — that enqueue is a documented TODO. The route always responds `{ received: true }`
fast so Stripe doesn't retry.

> Set these three fields as **Session metadata** when creating the Checkout Session (the live-SDK
> TODO already maps `clientName` / `handle` / `rebrandConfig` into `metadata`). If you create
> sessions any other way, you must still set `metadata.clientName` or fulfilment is a no-op.

---

## Stripe Dashboard steps

1. **Product + price** — Dashboard → **Product catalog** → **Add product**. Create a product (e.g.
   "Disco rebrand build") and a price. You can pass either the **Price id** (`price_…`) or a raw
   cent amount as the checkout `price` field — `checkout` accepts `number | string`.
2. **Webhook endpoint** — Dashboard → **Developers → Webhooks → Add endpoint**. Endpoint URL =
   your deployed API + `/stripe/webhook` (e.g. `https://api.yourdomain.com/stripe/webhook`).
3. **Events to subscribe** — select **`checkout.session.completed`**. That is the only event the
   code handles; any other event is accepted and ignored.
4. **Signing secret** — after creating the endpoint, copy its **Signing secret** (`whsec_…`) into
   `STRIPE_WEBHOOK_SECRET`.
5. **Secret key** — Dashboard → **Developers → API keys** → copy the **Secret key** (`sk_live_…` or
   `sk_test_…`) into `STRIPE_SECRET_KEY`.

---

## Copy-paste `.env`

```dotenv
# Stripe — live sales flow
# Secret key: gates POST /stripe/checkout (live branch is currently a 501 TODO until the SDK is wired)
STRIPE_SECRET_KEY=sk_live_<paste-your-secret-key-here>
# Webhook signing secret (whsec_…) from your /stripe/webhook endpoint — enables signature verification
STRIPE_WEBHOOK_SECRET=whsec_<paste-your-webhook-signing-secret-here>
# Base origin used for success_url / cancel_url when the live checkout SDK is wired
WEB_ORIGIN=https://app.yourdomain.com
```

Leave both `STRIPE_*` vars unset to stay in scaffold mode (the flow stays fully exercisable without
a Stripe account).

---

## 5-step go-live checklist

1. **Create product + price** in the Stripe Dashboard; note the `price_…` id (or use a cent amount).
2. **Add the webhook endpoint** pointing at `https://<your-api>/stripe/webhook` and subscribe to
   **`checkout.session.completed`** only.
3. **Paste keys** — `STRIPE_SECRET_KEY` (`sk_…`) and `STRIPE_WEBHOOK_SECRET` (`whsec_…`) into the
   API env; set a real `WEB_ORIGIN`. Restart the API.
4. **Wire the live checkout SDK** — replace the `501` TODO branch in `apps/api/src/stripe.ts` with
   the commented `stripe.checkout.sessions.create(...)` call, ensuring `metadata.clientName` (and
   `handle` / `rebrandConfig`) are set on the session.
5. **Send a test event** from the Dashboard (or run a Stripe test-mode checkout) and confirm a
   client is auto-created from `metadata.clientName` and the endpoint returns `{ received: true }`.
```
