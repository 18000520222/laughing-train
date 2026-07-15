import { cookies } from 'next/headers';
import { SignJWT } from 'jose/jwt/sign';
import { jwtVerify } from 'jose/jwt/verify';
import type { SessionPayload } from '@/lib/auth';

const MAX_AGE_SECONDS = 10 * 60;

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) throw new Error('AUTH_SECRET is missing or too short.');
  return new TextEncoder().encode(value);
}

function cookieName(provider: string) {
  return `erdi_oauth_${provider.toLowerCase().replace(/[^a-z0-9]/g, '')}_state`;
}

export async function createOAuthState(provider: string, session: SessionPayload): Promise<string> {
  const normalizedProvider = provider.toUpperCase();
  const state = await new SignJWT({ provider: normalizedProvider, userId: session.userId, purpose: 'oauth_state' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());
  const cookieStore = await cookies();
  cookieStore.set(cookieName(normalizedProvider), state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
  return state;
}

export async function consumeOAuthState(provider: string, suppliedState: string | null): Promise<{ userId: string } | null> {
  const normalizedProvider = provider.toUpperCase();
  const cookieStore = await cookies();
  const name = cookieName(normalizedProvider);
  const storedState = cookieStore.get(name)?.value || '';
  cookieStore.delete(name);
  if (!suppliedState || !storedState || suppliedState !== storedState) return null;
  try {
    const { payload } = await jwtVerify(suppliedState, secret());
    if (payload.purpose !== 'oauth_state' || payload.provider !== normalizedProvider || !payload.userId) return null;
    return { userId: String(payload.userId) };
  } catch {
    return null;
  }
}
