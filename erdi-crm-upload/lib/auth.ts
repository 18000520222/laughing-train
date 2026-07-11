import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';

export type Role = 'SUPER_ADMIN' | 'SALES' | 'FINANCE';

export interface SessionPayload {
  userId: string;
  email: string;
  name: string;
  role: Role;
}

const SESSION_COOKIE = 'erdi_session';
const MAX_AGE_SECONDS = 60 * 60 * 12; // 12h

export function authCookieDomain(): string | undefined {
  return process.env.AUTH_COOKIE_DOMAIN?.trim() || undefined;
}

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('AUTH_SECRET is missing or too short (need >=16 chars). Set it in env.');
  }
  return new TextEncoder().encode(secret);
}

/** Normalize legacy/mixed-case role strings to canonical Role. */
export function normalizeRole(raw: string | undefined | null): Role {
  const r = (raw || '').toUpperCase();
  if (r === 'SUPER_ADMIN' || r === 'ADMIN') return 'SUPER_ADMIN';
  if (r === 'FINANCE') return 'FINANCE';
  return 'SALES';
}

/** Create a signed session JWT and set it as an httpOnly cookie. */
export async function createSession(payload: SessionPayload): Promise<void> {
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(getSecret());

  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    domain: authCookieDomain(),
    maxAge: MAX_AGE_SECONDS,
  });
}

/** Read & verify the signed session. Returns null if missing/invalid/expired. */
export async function getSession(): Promise<SessionPayload | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return {
      userId: String(payload.userId || ''),
      email: String(payload.email || ''),
      name: String(payload.name || ''),
      role: normalizeRole(payload.role as string),
    };
  } catch {
    return null;
  }
}

/** Verify a raw token string (for middleware on edge runtime). */
export async function verifyToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return {
      userId: String(payload.userId || ''),
      email: String(payload.email || ''),
      name: String(payload.name || ''),
      role: normalizeRole(payload.role as string),
    };
  } catch {
    return null;
  }
}

export function clearSession(): void {
  cookies().delete(SESSION_COOKIE);
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
