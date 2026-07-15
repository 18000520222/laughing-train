import { NextRequest, NextResponse } from 'next/server';
import { AUTOMATION_CORE_TEMPLATE_KEYS } from '@/lib/automation';
import { createAutomationBlueprintPack } from '@/lib/automation-blueprint';
import { isCronAuthorized } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const AUTOMATION_BOOTSTRAP_KEY =
  process.env.AUTOMATION_BOOTSTRAP_KEY ||
  process.env.AUTOMATION_HEALTH_KEY ||
  process.env.AUTOMATION_TIMEOUT_KEY ||
  process.env.MAIL_CRON_KEY;

function parseKeys(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('templateKeys') || '';
  return raw
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
}

function parseStatus(req: NextRequest) {
  return req.nextUrl.searchParams.get('status') === 'DRAFT' ? 'DRAFT' : 'ACTIVE';
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req, [AUTOMATION_BOOTSTRAP_KEY])) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const keys = parseKeys(req);
  const status = parseStatus(req);
  const result = await createAutomationBlueprintPack({
    keys: keys.length ? keys : AUTOMATION_CORE_TEMPLATE_KEYS,
    status,
  });
  return NextResponse.json({ ok: true, ts: new Date().toISOString(), ...result });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
