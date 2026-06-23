import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from './env.js';

export interface Session {
  email: string;
}

/** Verify operator credentials. With no configured hash, dev login accepts password "disco". */
export async function verifyCredentials(email: string, password: string): Promise<boolean> {
  if (email.toLowerCase() !== env.operatorEmail.toLowerCase()) return false;
  if (!env.operatorPasswordHash) return password === 'disco';
  return bcrypt.compare(password, env.operatorPasswordHash);
}

export function signSession(session: Session): string {
  return jwt.sign(session, env.sessionSecret, { expiresIn: '7d' });
}

export function verifySession(token: string): Session | null {
  try {
    const decoded = jwt.verify(token, env.sessionSecret);
    if (typeof decoded === 'object' && decoded && 'email' in decoded) {
      return { email: String((decoded as { email: unknown }).email) };
    }
    return null;
  } catch {
    return null;
  }
}
