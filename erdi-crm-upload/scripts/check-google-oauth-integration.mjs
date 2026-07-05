import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const schema = read('prisma/schema.prisma');
const startRoute = read('app/api/auth/google/start/route.ts');
const callbackRoute = read('app/api/auth/google/callback/route.ts');
const mailPull = read('app/api/cron/mail-pull/route.ts');
const oauthHelper = read('lib/google-gmail-oauth.ts');
const settingsPage = read('app/settings/channels/page.tsx');

const checks = [
  {
    ok: schema.includes('googleClientId') && schema.includes('googleClientSecret'),
    message: 'SystemSettings is missing Google OAuth client fields',
  },
  {
    ok: schema.includes('authType') && schema.includes('oauthRefreshToken') && schema.includes('oauthAccessToken') && schema.includes('oauthTokenExpiresAt'),
    message: 'EmailAccount is missing OAuth token fields',
  },
  {
    ok: startRoute.includes('https://accounts.google.com/o/oauth2/v2/auth') && startRoute.includes('access_type') && startRoute.includes('https://mail.google.com/'),
    message: 'Google OAuth start route is missing offline Gmail scope flow',
  },
  {
    ok: callbackRoute.includes('https://oauth2.googleapis.com/token') && callbackRoute.includes('openidconnect.googleapis.com') && callbackRoute.includes('emailAccount.upsert'),
    message: 'Google OAuth callback is missing token exchange/profile/upsert flow',
  },
  {
    ok: mailPull.includes('buildEmailImapAuth') && oauthHelper.includes('oauth2.googleapis.com/token') && oauthHelper.includes('accessToken'),
    message: 'Mail pull route is not using refreshed OAuth access tokens',
  },
  {
    ok: settingsPage.includes('/api/auth/google/start') && settingsPage.includes('/api/auth/google/callback') && settingsPage.includes('googleClientId') && settingsPage.includes('oauthRefreshToken'),
    message: 'Channel settings page is missing Google OAuth controls/health',
  },
];

const failures = checks.filter((check) => !check.ok);
if (failures.length) {
  for (const failure of failures) console.error(failure.message);
  process.exitCode = 1;
} else {
  console.log('google oauth integration smoke passed: settings, routes, schema and mail pull are wired');
}
