export function canonicalOrigin() {
  return process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || 'https://erdicrm.com';
}
