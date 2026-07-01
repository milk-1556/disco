import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Finding 1 (adversarial review): a DB operator whose email is in ADMIN_EMAILS would escalate to admin
 * at login, because roleFor() derives admin from ADMIN_EMAILS regardless of the stored 'operator' role.
 * The fix rejects any admin email at invite time AND refuses an admin-email DB row at login. This test
 * sets ADMIN_EMAILS *before* importing the modules (roleFor caches it at load) and proves both guards.
 */
describe('multi-operator: ADMIN_EMAILS escalation is blocked (Finding 1)', () => {
  let app: FastifyInstance;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let signSession: (s: { email: string }) => string;
  let admin: Record<string, string>;

  beforeAll(async () => {
    vi.resetModules();
    process.env.ADMIN_EMAILS = 'operator@disco.local,extra-admin@x.com';
    const [{ signSession: sign }, { InMemoryRepo }, { buildServer }] = await Promise.all([
      import('../src/auth.js'),
      import('../src/repo.js'),
      import('../src/server.js'),
    ]);
    signSession = sign;
    const repo = new InMemoryRepo(true);
    // Plant a DB operator whose email is an ADMIN_EMAILS member (simulating a rogue direct DB write —
    // the API invite guard blocks this, but login must ALSO refuse it).
    await repo.addOperator({ email: 'extra-admin@x.com', passwordHash: bcrypt.hashSync('plantedpw', 10) });
    app = buildServer({ repo });
    await app.ready();
    admin = { authorization: `Bearer ${signSession({ email: 'operator@disco.local' })}`, 'content-type': 'application/json' };
  });
  afterAll(async () => { await app?.close(); delete process.env.ADMIN_EMAILS; vi.resetModules(); });

  it('POST /operators refuses an email that is in ADMIN_EMAILS (not just OPERATOR_EMAIL)', async () => {
    const r = await app.inject({ method: 'POST', url: '/operators', headers: admin, payload: JSON.stringify({ email: 'extra-admin@x.com', password: 'password1' }) });
    expect(r.statusCode).toBe(409);
  });

  it('a planted admin-email DB row CANNOT log in (login refuses admin emails on the DB path)', async () => {
    const r = await app.inject({ method: 'POST', url: '/auth/login', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ email: 'extra-admin@x.com', password: 'plantedpw' }) });
    expect(r.statusCode).toBe(401); // would be 200 + admin token without the fix
  });
});
