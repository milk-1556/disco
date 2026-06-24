import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signSession } from '../src/auth.js';
import { InMemoryRepo } from '../src/repo.js';
import { buildServer } from '../src/server.js';
import { verifyStripeSignature } from '../src/stripe.js';

/**
 * Exercises the Stripe sales-flow scaffold WITHOUT any real keys:
 *  - the webhook (scaffold mode, no STRIPE_WEBHOOK_SECRET) accepts a mock
 *    `checkout.session.completed` event and auto-creates a client from session metadata;
 *  - the checkout route returns the deterministic scaffold URL.
 *
 * We don't edit server.ts — we build a server with an in-memory repo and register the stripe routes
 * onto it here, then drive everything through Fastify's `inject()` (no real socket needed).
 */
describe('stripe sales-flow scaffold', () => {
  let app: FastifyInstance;
  let repo: InMemoryRepo;
  const token = signSession({ email: 'operator@disco.local' });

  beforeEach(async () => {
    // No Stripe env vars → scaffold mode for both routes.
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    repo = new InMemoryRepo(/* seed */ true);
    app = buildServer({ repo });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('webhook → auto-creates a client from session metadata (scaffold mode, no secret)', async () => {
    const before = await repo.listClients();
    const event = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_123',
          metadata: { clientName: 'Stripe Buyer', handle: '@stripebuyer' },
        },
      },
    };

    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(event),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true });

    const after = await repo.listClients();
    expect(after.length).toBe(before.length + 1);
    const created = after.find((c) => c.creatorName === 'Stripe Buyer');
    expect(created).toBeDefined();
    expect(created!.handle).toBe('@stripebuyer');
    expect(created!.notes).toContain('cs_test_123');
  });

  it('webhook ignores non-completion events (no client created)', async () => {
    const before = await repo.listClients();
    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ type: 'payment_intent.created', data: { object: {} } }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true });
    expect((await repo.listClients()).length).toBe(before.length);
  });

  it('checkout (auth) returns the scaffold url echoing line items', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/stripe/checkout',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      payload: JSON.stringify({ clientName: 'Nova', price: 4900 }),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { url: string; mode: string; note: string; lineItems: { amount: number }[] };
    expect(body.url).toBe('https://checkout.stripe.com/pay/SCAFFOLD');
    expect(body.mode).toBe('scaffold');
    expect(body.lineItems[0]!.amount).toBe(4900);
  });

  it('checkout requires auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/stripe/checkout',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ clientName: 'Nova', price: 4900 }),
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('verifyStripeSignature (node:crypto HMAC, self-contained)', () => {
  const secret = 'whsec_test_secret';
  const rawBody = JSON.stringify({ type: 'checkout.session.completed', data: { object: {} } });

  const sign = (ts: number, body: string, key = secret) =>
    `t=${ts},v1=${createHmac('sha256', key).update(`${ts}.${body}`).digest('hex')}`;

  it('accepts a correctly-signed payload', () => {
    const ts = Math.floor(Date.now() / 1000);
    expect(verifyStripeSignature(rawBody, sign(ts, rawBody), secret)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const ts = Math.floor(Date.now() / 1000);
    const header = sign(ts, rawBody);
    expect(verifyStripeSignature(rawBody + 'x', header, secret)).toBe(false);
  });

  it('rejects a wrong secret', () => {
    const ts = Math.floor(Date.now() / 1000);
    expect(verifyStripeSignature(rawBody, sign(ts, rawBody, 'whsec_wrong'), secret)).toBe(false);
  });

  it('rejects a malformed header', () => {
    expect(verifyStripeSignature(rawBody, 'garbage', secret)).toBe(false);
    expect(verifyStripeSignature(rawBody, '', secret)).toBe(false);
  });

  it('end-to-end: a signed webhook with a real secret creates the client', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = secret;
    const repo = new InMemoryRepo(true);
    const app = buildServer({ repo });
    await app.ready();
    try {
      const ts = Math.floor(Date.now() / 1000);
      const payload = JSON.stringify({
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_signed_1', metadata: { clientName: 'Signed Buyer', handle: '@signed' } } },
      });
      const ok = await app.inject({
        method: 'POST',
        url: '/stripe/webhook',
        headers: { 'content-type': 'application/json', 'stripe-signature': sign(ts, payload) },
        payload,
      });
      expect(ok.statusCode).toBe(200);
      expect((await repo.listClients()).some((c) => c.creatorName === 'Signed Buyer')).toBe(true);

      // A bad signature is rejected with 400 and creates nothing.
      const bad = await app.inject({
        method: 'POST',
        url: '/stripe/webhook',
        headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' },
        payload,
      });
      expect(bad.statusCode).toBe(400);
    } finally {
      delete process.env.STRIPE_WEBHOOK_SECRET;
      await app.close();
    }
  });
});

describe('stripe money-path hardening (adversarial-audit fixes)', () => {
  const token = signSession({ email: 'operator@disco.local' });
  let app: FastifyInstance;
  let repo: InMemoryRepo;
  beforeEach(async () => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    repo = new InMemoryRepo(true);
    app = buildServer({ repo });
    await app.ready();
  });
  afterEach(async () => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    await app.close();
  });

  it('malformed JSON returns a clean 400, not a 500 (raw-body parser tags statusCode)', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login', headers: { 'content-type': 'application/json' }, payload: '{bad' });
    expect(res.statusCode).toBe(400);
  });

  it('FAIL CLOSED: live key set but no webhook secret → webhook rejects unsigned event', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
    const before = (await repo.listClients()).length;
    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_x', payment_status: 'paid', metadata: { clientName: 'Forged' } } } }),
    });
    expect(res.statusCode).toBe(400);
    expect((await repo.listClients()).length).toBe(before); // no client created from a forged event
  });

  it('live mode: a signed but UNPAID session does not create a client', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_dummy';
    const before = (await repo.listClients()).length;
    const body = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_unpaid', payment_status: 'unpaid', metadata: { clientName: 'Unpaid Co' } } } });
    const t = Math.floor(Date.now() / 1000);
    const sig = `t=${t},v1=${createHmac('sha256', 'whsec_dummy').update(`${t}.${body}`).digest('hex')}`;
    const res = await app.inject({ method: 'POST', url: '/stripe/webhook', headers: { 'content-type': 'application/json', 'stripe-signature': sig }, payload: body });
    expect(res.statusCode).toBe(200); // acknowledged...
    expect((await repo.listClients()).length).toBe(before); // ...but NOT fulfilled
  });

  it('checkout rejects a non-integer / negative price', async () => {
    const bad = await app.inject({ method: 'POST', url: '/stripe/checkout', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, payload: JSON.stringify({ clientName: 'X', price: -100 }) });
    expect(bad.statusCode).toBe(400);
  });
});

describe('stripe webhook idempotency (unique session-id dedup)', () => {
  it('the same checkout.session.completed delivered 3× creates exactly ONE client', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const repo = new InMemoryRepo(true);
    const app = buildServer({ repo });
    await app.ready();
    try {
      const before = (await repo.listClients()).length;
      const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_idem_1', payment_status: 'paid', metadata: { clientName: 'Idem Co' } } } });
      for (let i = 0; i < 3; i++) {
        const res = await app.inject({ method: 'POST', url: '/stripe/webhook', headers: { 'content-type': 'application/json' }, payload });
        expect(res.statusCode).toBe(200);
      }
      const clients = await repo.listClients();
      expect(clients.length).toBe(before + 1);
      expect(clients.filter((c) => c.creatorName === 'Idem Co').length).toBe(1);
      expect(clients.find((c) => c.creatorName === 'Idem Co')?.stripeSessionId).toBe('cs_idem_1');
    } finally {
      await app.close();
    }
  });

  it('CONCURRENT identical webhooks still create exactly ONE client (in-memory atomic dedup)', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const repo = new InMemoryRepo(true);
    const app = buildServer({ repo });
    await app.ready();
    try {
      const before = (await repo.listClients()).length;
      const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_race_1', payment_status: 'paid', metadata: { clientName: 'Race Co' } } } });
      // Fire them concurrently — the read-then-create check interleaves; only the addClient uniqueness
      // guard prevents a double-create. All requests still ack 200 (the dedup is swallowed).
      const results = await Promise.all(
        Array.from({ length: 5 }, () => app.inject({ method: 'POST', url: '/stripe/webhook', headers: { 'content-type': 'application/json' }, payload })),
      );
      expect(results.every((r) => r.statusCode === 200)).toBe(true);
      expect((await repo.listClients()).filter((c) => c.creatorName === 'Race Co').length).toBe(1);
      expect((await repo.listClients()).length).toBe(before + 1);
    } finally {
      await app.close();
    }
  });

  it('production with NO stripe keys rejects an unsigned webhook (no forged client)', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const repo = new InMemoryRepo(true);
    const app = buildServer({ repo });
    await app.ready();
    try {
      const before = (await repo.listClients()).length;
      const res = await app.inject({ method: 'POST', url: '/stripe/webhook', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_forged', payment_status: 'paid', metadata: { clientName: 'Forged Prod' } } } }) });
      expect(res.statusCode).toBe(400); // refuse to fulfil a forged unsigned event in prod
      expect((await repo.listClients()).length).toBe(before);
    } finally {
      process.env.NODE_ENV = prev;
      await app.close();
    }
  });
});
