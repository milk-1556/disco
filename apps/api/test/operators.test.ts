import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signSession } from '../src/auth.js';
import { InMemoryRepo } from '../src/repo.js';
import { buildServer } from '../src/server.js';

/**
 * Multi-operator / white-label auth: an admin invites DB-backed operators who can log in and are
 * owner-scoped. The env bootstrap admin path must be UNTOUCHED (it always works). These tests guard the
 * money-path: no privilege escalation, no cross-operator access, current-password required for changes.
 */
describe('multi-operator accounts (DB-backed, additive)', () => {
  let app: FastifyInstance;
  const admin = { authorization: `Bearer ${signSession({ email: 'operator@disco.local' })}`, 'content-type': 'application/json' }; // env admin
  const json = (r: { json: () => unknown }) => r.json();
  beforeAll(async () => { app = buildServer({ repo: new InMemoryRepo(true) }); await app.ready(); });
  afterAll(async () => { await app.close(); });

  it('env admin login is unchanged and works with the dev password', async () => {
    const r = await app.inject({ method: 'POST', url: '/auth/login', payload: JSON.stringify({ email: 'operator@disco.local', password: 'disco' }), headers: { 'content-type': 'application/json' } });
    expect(r.statusCode).toBe(200);
    expect((json(r) as { token: string }).token).toBeTruthy();
  });

  it('admin invites a DB operator, who can then log in (and is role=operator, scoped)', async () => {
    const created = await app.inject({ method: 'POST', url: '/operators', headers: admin, payload: JSON.stringify({ email: 'Team@Agency.com', password: 'sup3rsecret' }) });
    expect(created.statusCode).toBe(200);
    expect((json(created) as { email: string; role: string }).email).toBe('team@agency.com'); // lowercased
    expect((json(created) as { role: string }).role).toBe('operator');

    // login works (case-insensitive email)
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: JSON.stringify({ email: 'team@agency.com', password: 'sup3rsecret' }), headers: { 'content-type': 'application/json' } });
    expect(login.statusCode).toBe(200);
    const opAuth = { authorization: `Bearer ${(json(login) as { token: string }).token}`, 'content-type': 'application/json' };

    // the DB operator is SCOPED: they cannot list operators (admin-only)
    expect((await app.inject({ method: 'GET', url: '/operators', headers: opAuth })).statusCode).toBe(403);
    // and they cannot invite operators
    expect((await app.inject({ method: 'POST', url: '/operators', headers: opAuth, payload: JSON.stringify({ email: 'x@y.com', password: 'password1' }) })).statusCode).toBe(403);
    // their data is owner-scoped: a fresh operator sees zero snapshots (the seed belongs to the admin)
    expect(((await app.inject({ method: 'GET', url: '/snapshots', headers: opAuth })).json() as unknown[]).length).toBe(0);
  });

  it('rejects a wrong password, a non-existent email, and bad input', async () => {
    expect((await app.inject({ method: 'POST', url: '/auth/login', payload: JSON.stringify({ email: 'team@agency.com', password: 'wrong' }), headers: { 'content-type': 'application/json' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/auth/login', payload: JSON.stringify({ email: 'nobody@nowhere.com', password: 'whatever1' }), headers: { 'content-type': 'application/json' } })).statusCode).toBe(401);
    // can't shadow the admin email, can't duplicate, password too short, bad email
    expect((await app.inject({ method: 'POST', url: '/operators', headers: admin, payload: JSON.stringify({ email: 'operator@disco.local', password: 'password1' }) })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/operators', headers: admin, payload: JSON.stringify({ email: 'team@agency.com', password: 'password1' }) })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/operators', headers: admin, payload: JSON.stringify({ email: 'short@pw.com', password: 'short' }) })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/operators', headers: admin, payload: JSON.stringify({ email: 'notanemail', password: 'password1' }) })).statusCode).toBe(400);
  });

  it('self-service password change requires the current password; env admin cannot change here', async () => {
    const op = { authorization: `Bearer ${signSession({ email: 'team@agency.com' })}`, 'content-type': 'application/json' };
    // wrong current password → 401
    expect((await app.inject({ method: 'POST', url: '/auth/change-password', headers: op, payload: JSON.stringify({ currentPassword: 'nope', newPassword: 'brandnewpw' }) })).statusCode).toBe(401);
    // correct current → 200, and the new password then logs in (old one fails)
    expect((await app.inject({ method: 'POST', url: '/auth/change-password', headers: op, payload: JSON.stringify({ currentPassword: 'sup3rsecret', newPassword: 'brandnewpw' }) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/auth/login', payload: JSON.stringify({ email: 'team@agency.com', password: 'brandnewpw' }), headers: { 'content-type': 'application/json' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/auth/login', payload: JSON.stringify({ email: 'team@agency.com', password: 'sup3rsecret' }), headers: { 'content-type': 'application/json' } })).statusCode).toBe(401);
    // the env admin can't change password via the app (env-based)
    expect((await app.inject({ method: 'POST', url: '/auth/change-password', headers: admin, payload: JSON.stringify({ currentPassword: 'disco', newPassword: 'somethingnew' }) })).statusCode).toBe(400);
  });

  it('admin can remove an operator, after which their login stops working', async () => {
    const list = (await app.inject({ method: 'GET', url: '/operators', headers: admin })).json() as { id: string; email: string }[];
    const target = list.find((o) => o.email === 'team@agency.com')!;
    expect((await app.inject({ method: 'DELETE', url: `/operators/${target.id}`, headers: admin })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/auth/login', payload: JSON.stringify({ email: 'team@agency.com', password: 'brandnewpw' }), headers: { 'content-type': 'application/json' } })).statusCode).toBe(401);
  });
});

describe('multi-operator: review gap tests (role, hash-leak, cross-op)', () => {
  let app: FastifyInstance;
  const admin = { authorization: `Bearer ${signSession({ email: 'operator@disco.local' })}`, 'content-type': 'application/json' };
  beforeAll(async () => { app = buildServer({ repo: new InMemoryRepo(true) }); await app.ready(); });
  afterAll(async () => { await app.close(); });

  it('a client-supplied role:"admin" on invite is IGNORED (created as operator)', async () => {
    const r = await app.inject({ method: 'POST', url: '/operators', headers: admin, payload: JSON.stringify({ email: 'sneaky@x.com', password: 'password1', role: 'admin' }) });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { role: string }).role).toBe('operator');
    // and they truly can't reach admin routes
    const tok = { authorization: `Bearer ${signSession({ email: 'sneaky@x.com' })}` };
    expect((await app.inject({ method: 'GET', url: '/operators', headers: tok })).statusCode).toBe(403);
  });

  it('GET /operators never leaks passwordHash', async () => {
    const raw = (await app.inject({ method: 'GET', url: '/operators', headers: admin })).payload;
    expect(raw.toLowerCase()).not.toContain('passwordhash');
    expect(raw).not.toContain('$2'); // no bcrypt hash prefix
  });

  it('change-password uses the SESSION email, ignoring any body-supplied email (no cross-op reset)', async () => {
    await app.inject({ method: 'POST', url: '/operators', headers: admin, payload: JSON.stringify({ email: 'victim@x.com', password: 'victimpass' }) });
    await app.inject({ method: 'POST', url: '/operators', headers: admin, payload: JSON.stringify({ email: 'attacker@x.com', password: 'attackpass' }) });
    const attacker = { authorization: `Bearer ${signSession({ email: 'attacker@x.com' })}`, 'content-type': 'application/json' };
    // attacker tries to reset victim's password by smuggling email/operator in the body
    await app.inject({ method: 'POST', url: '/auth/change-password', headers: attacker, payload: JSON.stringify({ email: 'victim@x.com', operator: 'victim@x.com', currentPassword: 'attackpass', newPassword: 'pwned1234' }) });
    // victim's password is unchanged (still logs in with the original)
    expect((await app.inject({ method: 'POST', url: '/auth/login', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ email: 'victim@x.com', password: 'victimpass' }) })).statusCode).toBe(200);
    // and it was the ATTACKER's own password that changed
    expect((await app.inject({ method: 'POST', url: '/auth/login', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ email: 'attacker@x.com', password: 'pwned1234' }) })).statusCode).toBe(200);
  });
});
