export function isCronAuthorized(
  req: Request,
  envKeys: Array<string | null | undefined>,
  devFallbackKeys: string[] = [],
): boolean {
  const auth = req.headers.get('authorization') || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;

  const key = new URL(req.url).searchParams.get('key');
  if (!key) return false;

  const configuredKeys = envKeys.filter((value): value is string => Boolean(value));
  if (configuredKeys.includes(key)) return true;

  return process.env.NODE_ENV !== 'production' && devFallbackKeys.includes(key);
}
