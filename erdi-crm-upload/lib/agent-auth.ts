import { timingSafeEqual } from 'crypto';

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function getBearerToken(request: Request): string {
  const authorization = request.headers.get('authorization') || '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

export function isAgentAuthorized(request: Request): boolean {
  const expected = process.env.ERDI_AGENT_TOKEN || '';
  const supplied = getBearerToken(request);
  return expected.length >= 32 && supplied.length >= 32 && safeEqual(supplied, expected);
}
