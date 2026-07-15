import { cookies } from 'next/headers';
import { SignJWT } from 'jose/jwt/sign';
import { jwtVerify } from 'jose/jwt/verify';
import { prisma } from '@/lib/prisma';

export const ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'SALES',
  'PURCHASING',
  'FINANCE',
  'DOCUMENT',
  'OPERATIONS',
] as const;

export type Role = (typeof ROLES)[number];

export interface SessionPayload {
  userId: string;
  email: string;
  name: string;
  role: Role;
  sessionVersion: number;
  mustChangePassword: boolean;
}

const SESSION_COOKIE = 'erdi_session';
const MAX_AGE_SECONDS = 60 * 60 * 12;

export function authCookieDomain(): string | undefined {
  return process.env.AUTH_COOKIE_DOMAIN?.trim() || undefined;
}

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('AUTH_SECRET is missing or too short (need >=32 chars).');
  }
  return new TextEncoder().encode(secret);
}

export function normalizeRole(raw: string | undefined | null): Role {
  const role = (raw || '').toUpperCase();
  return ROLES.includes(role as Role) ? (role as Role) : 'SALES';
}

export async function createSession(payload: SessionPayload): Promise<void> {
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(getSecret());

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    domain: authCookieDomain(),
    maxAge: MAX_AGE_SECONDS,
  });
}

async function decodeToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const session = {
      userId: String(payload.userId || ''),
      email: String(payload.email || '').toLowerCase(),
      name: String(payload.name || ''),
      role: normalizeRole(payload.role as string),
      sessionVersion: Number(payload.sessionVersion || 0),
      mustChangePassword: Boolean(payload.mustChangePassword),
    };
    return session.userId && session.email ? session : null;
  } catch {
    return null;
  }
}

/**
 * Verify both the JWT and the current database account state. This makes role
 * changes, password resets and employee deactivation take effect immediately.
 */
export async function verifyToken(token: string): Promise<SessionPayload | null> {
  const signed = await decodeToken(token);
  if (!signed) return null;

  const user = await prisma.user.findUnique({
    where: { id: signed.userId },
    select: { id: true, email: true, name: true, role: true, isActive: true, sessionVersion: true, mustChangePassword: true },
  });
  if (!user || !user.isActive || user.email.toLowerCase() !== signed.email) return null;
  if (user.sessionVersion !== signed.sessionVersion) return null;

  return {
    userId: user.id,
    email: user.email.toLowerCase(),
    name: user.name || user.email,
    role: normalizeRole(user.role),
    sessionVersion: user.sessionVersion,
    mustChangePassword: user.mustChangePassword,
  };
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  return token ? verifyToken(token) : null;
}

export async function clearSession(): Promise<void> {
  const domain = authCookieDomain();
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  if (domain) cookieStore.set(SESSION_COOKIE, '', { path: '/', domain, maxAge: 0 });
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
