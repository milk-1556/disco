import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifySession } from './auth.js';
import type { Repo } from './repo.js';

/**
 * Stripe SALES-FLOW scaffold (§ monetization).
 *
 * This is a self-contained scaffold — no `stripe` npm dependency and no live keys required. The
 * webhook signature check is reimplemented over `node:crypto` HMAC so the whole flow is testable in
 * CI without network or a Stripe account. When real keys ARE configured the same routes are the
 * place to drop in the official SDK calls (marked TODO below).
 *
 * Two routes:
 *   POST /stripe/checkout  (auth)    — create (or scaffold) a Checkout Session for a client purchase.
 *   POST /stripe/webhook   (no auth) — Stripe → us; verify signature, then fulfil on completion.
 */

interface CheckoutBody {
  clientName?: string;
  /** Price in the smallest currency unit (cents), or a Stripe Price id — operator's choice. */
  price?: number | string;
  /** Optional rebrand config to stash on the session so the webhook can auto-kick the build. */
  rebrandConfig?: unknown;
}

/** A line item we echo back in scaffold mode (and would pass to Stripe in live mode). */
interface LineItem {
  name: string;
  /** Smallest currency unit (cents) when numeric, else the referenced Stripe Price id. */
  amount: number | string;
  quantity: number;
}

/** Minimal shape of the Stripe event envelope we care about (scaffold — not the full SDK type). */
interface StripeEvent {
  type?: string;
  data?: { object?: StripeSession };
}
interface StripeSession {
  id?: string;
  payment_status?: string;
  metadata?: { clientName?: string; handle?: string; rebrandConfig?: string };
}

/**
 * Verify a Stripe-style `stripe-signature` header against the raw request body.
 *
 * Stripe's scheme: the header is `t=<unix-ts>,v1=<hex hmac>` (possibly with more v1=/v0= pairs); the
 * signed payload is `${timestamp}.${rawBody}` and the signature is HMAC-SHA256 keyed by the webhook
 * secret. We accept if ANY provided v1 matches (constant-time compare).
 *
 * Returns true when the signature is valid. In scaffold mode (no secret configured) the caller skips
 * this entirely and accepts the event.
 */
export function verifyStripeSignature(rawBody: string, signatureHeader: string, secret: string, toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000)): boolean {
  const parts = signatureHeader.split(',').map((p) => p.trim());
  let timestamp = '';
  const v1: string[] = [];
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq);
    const val = part.slice(eq + 1);
    if (key === 't') timestamp = val;
    else if (key === 'v1') v1.push(val);
  }
  if (!timestamp || v1.length === 0) return false;

  // Replay protection: reject events whose signed timestamp is outside the tolerance window. Without
  // this, a captured-but-valid webhook could be replayed indefinitely to re-trigger fulfilment.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > toleranceSec) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');
  // Constant-time compare against each candidate; only equal-length buffers can match.
  return v1.some((candidate) => {
    const candBuf = Buffer.from(candidate, 'utf8');
    return candBuf.length === expectedBuf.length && timingSafeEqual(candBuf, expectedBuf);
  });
}

export function registerStripeRoutes(app: FastifyInstance, repo: Repo): void {
  // ── raw-body capture for the webhook ──
  // Stripe signs the EXACT bytes it sent; any re-serialization (JSON.parse→stringify) changes the
  // payload and breaks verification. So we register a content-type parser that keeps the raw string
  // and ALSO parses it to JSON, stashing both on the request. This is scoped to this module's routes
  // by checking the URL — other routes keep Fastify's default JSON parsing untouched.
  app.removeContentTypeParser('application/json'); // replace Fastify's built-in JSON parser
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    if (req.url === '/stripe/webhook') {
      (req as FastifyRequest & { rawBody?: string }).rawBody = body as string;
    }
    try {
      done(null, body.length ? JSON.parse(body as string) : {});
    } catch (err) {
      // Tag the error 400 (Fastify's built-in parser does this) so malformed JSON on ANY route
      // returns a clean 400, not a 500 leaking the V8 parser message.
      const e = (err instanceof Error ? err : new Error('invalid json')) as Error & { statusCode?: number };
      e.statusCode = 400;
      done(e, undefined);
    }
  });

  // ── auth guard (mirrors server.ts requireAuth) ──
  const requireAuth = async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const session = verifySession(token);
    if (!session) {
      reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    (req as FastifyRequest & { session?: unknown }).session = session;
  };

  // ── POST /stripe/checkout (auth) ──
  // Create a Checkout Session for a client purchase. The clientName/handle/rebrandConfig ride along
  // as session metadata so the webhook can fulfil (auto-create the client + kick the build) with zero
  // extra state on our side.
  app.post('/stripe/checkout', { preHandler: requireAuth }, async (req, reply) => {
    const body = (req.body ?? {}) as CheckoutBody;
    const clientName = (body.clientName ?? '').trim();
    if (!clientName) return reply.code(400).send({ error: 'clientName required' });

    // Amount integrity: only the authed operator hits this route, but still validate — a numeric
    // price must be a non-negative integer (cents); otherwise it must be a Stripe Price id (price_…).
    let amount: number | string;
    if (typeof body.price === 'number') {
      if (!Number.isInteger(body.price) || body.price < 0) return reply.code(400).send({ error: 'price must be a non-negative integer (cents)' });
      amount = body.price;
    } else if (typeof body.price === 'string' && body.price.startsWith('price_')) {
      amount = body.price;
    } else if (body.price == null) {
      amount = 0;
    } else {
      return reply.code(400).send({ error: 'price must be cents (integer) or a Stripe Price id' });
    }
    const lineItems: LineItem[] = [{ name: `Disco rebrand — ${clientName}`, amount, quantity: 1 }];

    if (!process.env.STRIPE_SECRET_KEY) {
      // Scaffold mode: no key configured → return a deterministic fake session so the UI/flow is
      // exercisable end-to-end without Stripe.
      return {
        url: 'https://checkout.stripe.com/pay/SCAFFOLD',
        mode: 'scaffold' as const,
        note: 'set STRIPE_SECRET_KEY to create real sessions',
        lineItems,
      };
    }

    // ── LIVE MODE ── create a real Checkout Session via Stripe's REST API (form-encoded; no SDK
    // dependency, consistent with the node:crypto webhook verifier above). The customer pays on
    // Stripe's hosted page — no card data ever touches us — and the webhook fulfils on completion.
    const origin = (process.env.WEB_ORIGIN ?? '').replace(/\*/g, '').replace(/\/$/, '');
    const form = new URLSearchParams();
    form.set('mode', 'payment');
    form.set('success_url', `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`);
    form.set('cancel_url', `${origin}/?checkout=cancel`);
    form.set('line_items[0][quantity]', '1');
    if (typeof amount === 'string') {
      form.set('line_items[0][price]', amount); // a pre-created Stripe Price id
    } else {
      form.set('line_items[0][price_data][currency]', 'usd');
      form.set('line_items[0][price_data][unit_amount]', String(amount));
      form.set('line_items[0][price_data][product_data][name]', lineItems[0]!.name);
    }
    form.set('metadata[clientName]', clientName);
    form.set('metadata[handle]', (body as CheckoutBody & { handle?: string }).handle ?? '');
    if (body.rebrandConfig != null) form.set('metadata[rebrandConfig]', JSON.stringify(body.rebrandConfig));

    try {
      const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
          'content-type': 'application/x-www-form-urlencoded',
          // Idempotency: a retried create (network blip) returns the SAME session instead of a duplicate.
          'Idempotency-Key': createHmac('sha256', process.env.STRIPE_SECRET_KEY).update(form.toString()).digest('hex'),
        },
        body: form.toString(),
      });
      const session = (await res.json()) as { id?: string; url?: string; error?: { message?: string } };
      if (!res.ok || !session.url) {
        app.log.error({ stripeError: session.error?.message, status: res.status }, 'stripe checkout create failed');
        return reply.code(502).send({ error: 'Could not create the checkout session — check the Stripe key.' });
      }
      return { url: session.url, mode: 'live' as const, id: session.id };
    } catch (err) {
      app.log.error({ err: err instanceof Error ? err.message : String(err) }, 'stripe unreachable');
      return reply.code(502).send({ error: 'Stripe is unreachable right now — try again.' });
    }
  });

  // ── POST /stripe/webhook (NO auth) ──
  // Stripe → us. We must (1) verify the signature against the RAW body, then (2) fulfil the order.
  app.post('/stripe/webhook', async (req, reply) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    const sig = (req.headers['stripe-signature'] as string | undefined) ?? '';
    const rawBody = (req as FastifyRequest & { rawBody?: string }).rawBody ?? '';
    const liveMode = !!process.env.STRIPE_SECRET_KEY;

    if (secret) {
      if (!verifyStripeSignature(rawBody, sig, secret)) {
        return reply.code(400).send({ error: 'invalid signature' });
      }
    } else if (liveMode) {
      // FAIL CLOSED: a live key is configured but no webhook secret → refuse to fulfil unsigned events.
      // (Scaffold convenience must never disable signature checks on a real money path.)
      app.log.error('STRIPE_WEBHOOK_SECRET missing while live — rejecting unsigned webhook');
      return reply.code(400).send({ error: 'webhook signing secret not configured' });
    }
    // else: pure scaffold (no keys at all) → accept unverified so the flow is testable locally.

    const event = (req.body ?? {}) as StripeEvent;

    if (event.type === 'checkout.session.completed') {
      const session = event.data?.object ?? {};
      const meta = session.metadata ?? {};
      const clientName = (meta.clientName ?? '').trim();
      const sessionId = session.id ?? '';
      // Only fulfil a session whose payment actually SUCCEEDED. Stripe fires this event even for
      // unpaid/async sessions. (Scaffold test events omit payment_status, so accept when not live.)
      const paid = session.payment_status === 'paid' || !liveMode;
      // Idempotency: Stripe retries webhooks, so guard against double-fulfilment by session id — now an
      // INDEXED lookup on the unique stripeSessionId column (was an O(n) notes scan), with the unique
      // constraint as the atomic backstop against concurrent retries.
      const alreadyFulfilled = sessionId ? !!(await repo.clientByStripeSession(sessionId)) : false;
      if (clientName && paid && !alreadyFulfilled) {
        try {
          // Fulfilment: auto-create the client record from the session metadata.
          const client = await repo.addClient({
            creatorName: clientName,
            handle: meta.handle ?? '',
            brandColors: [],
            links: [],
            assets: {},
            termSwaps: [],
            notes: `Auto-created from paid Stripe checkout (session ${sessionId || 'unknown'}).`,
            buildPrice: 0,
            monthlyRetainer: 0,
            upsells: [],
            stripeSessionId: sessionId || null,
          });
          void client;
        } catch (err) {
          // unique-constraint race: a concurrent retry already fulfilled this session — safe to ignore.
          app.log.warn({ err: err instanceof Error ? err.message : String(err) }, 'stripe fulfilment deduped (session already processed)');
        }

        // ── KICK THE BUILD (TODO) ──
        // With the client created and a rebrandConfig carried in metadata, this is where we'd enqueue
        // the rebuild job — mirroring POST /jobs in server.ts:
        //   const config = JSON.parse(meta.rebrandConfig ?? 'null');
        //   const job = await repo.addJob({ kind: 'rebuild', status: 'queued', clientId: client.id, ... });
        //   useQueue() ? getQueue().add('rebuild', data, { jobId: job.id, ... })
        //              : runBuild(repo, channel, { jobId: job.id, ... });
      }
    }

    // Acknowledge fast so Stripe doesn't retry. Any heavy fulfilment work should be enqueued, not
    // done inline, in live mode.
    return { received: true };
  });
}
