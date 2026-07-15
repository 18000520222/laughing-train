import { createHmac, timingSafeEqual } from 'crypto';

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isWebhookTokenAuthorized(request: Request, expectedTokens: Array<string | null | undefined>): boolean {
  const authorization = request.headers.get('authorization') || '';
  const supplied = authorization.startsWith('Bearer ')
    ? authorization.slice(7).trim()
    : request.headers.get('x-erdi-webhook-token') || new URL(request.url).searchParams.get('token') || '';
  if (supplied.length < 32) return false;
  return expectedTokens.some((token) => Boolean(token && token.length >= 32 && safeEqual(supplied, token)));
}

export function verifySha256Webhook(rawBody: string, signatureHeader: string | null, secret: string | null | undefined): boolean {
  if (!secret || secret.length < 16 || !signatureHeader) return false;
  const supplied = signatureHeader.startsWith('sha256=') ? signatureHeader.slice(7) : signatureHeader;
  const hex = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const base64 = createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
  return safeEqual(supplied, hex) || safeEqual(supplied, base64);
}
