import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from './env.js';

export type Role = 'admin' | 'operator';
export interface Session {
  email: string;
  role: Role;
}

// Multi-operator readiness: roles are derived from config, so adding a 2nd operator is one line —
// ADMIN_EMAILS lists the admins; the sole configured OPERATOR_EMAIL is admin by default. Everyone
// else who can authenticate is a scoped 'operator' (sees only their own audit trail).
const adminEmails = new Set(
  (process.env.ADMIN_EMAILS ?? env.operatorEmail).split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
);
export function roleFor(email: string): Role {
  return adminEmails.has(email.toLowerCase()) ? 'admin' : 'operator';
}

/** Verify operator credentials. With no configured hash, dev login accepts password "disco". */
export async function verifyCredentials(email: string, password: string): Promise<boolean> {
  if (email.toLowerCase() !== env.operatorEmail.toLowerCase()) return false;
  if (!env.operatorPasswordHash) return password === 'disco';
  return bcrypt.compare(password, env.operatorPasswordHash);
}

/** Sign a session — accepts {email} and derives the role (so callers don't have to). */
export function signSession(session: { email: string }): string {
  return jwt.sign({ email: session.email }, env.sessionSecret, { expiresIn: '7d' });
}

export function verifySession(token: string): Session | null {
  try {
    const decoded = jwt.verify(token, env.sessionSecret);
    if (typeof decoded === 'object' && decoded && 'email' in decoded) {
      const email = String((decoded as { email: unknown }).email);
      return { email, role: roleFor(email) }; // role derived at verify time → reflects current config
    }
    return null;
  } catch {
    return null;
  }
}
