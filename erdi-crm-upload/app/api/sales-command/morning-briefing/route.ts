import { NextResponse } from 'next/server';
import { sendMorningBriefingNotifications } from '@/lib/sales-morning-briefing-watch';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN'];

export async function POST(req: Request) {
  const auth = await requireAdminUser();
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const form = await req.formData();
  const itemIds = parsePriorityItemIds(form);
  if (itemIds.length === 0) return redirectBack(req, 'invalid', 0, 1, 0);

  const result = await sendMorningBriefingNotifications({ itemIds });
  if (result.groupedTargets === 0) return redirectBack(req, 'empty', 0, result.skipped || result.requested, result.skippedDuplicates);
  return redirectBack(req, result.notified > 0 ? 'sent' : 'duplicate', result.notified, result.skipped, result.skippedDuplicates);
}

async function requireAdminUser() {
  const session = await getSession();
  if (!session || !ADMIN_ROLES.includes(session.role)) return null;
  return { user: { id: session.userId, email: session.email, name: session.name }, role: session.role };
}

function parsePriorityItemIds(form: FormData) {
  const values = [
    String(form.get('itemId') || ''),
    String(form.get('itemIds') || ''),
    ...form.getAll('itemIds').map((value) => String(value || '')),
  ];
  return Array.from(
    new Set(
      values
        .flatMap((value) => value.split(','))
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ).slice(0, 20);
}

function redirectBack(req: Request, status: string, notified: number, skipped: number, skippedDuplicates: number) {
  const url = new URL('/sales-command', req.url);
  url.searchParams.set('morningNotify', status);
  url.searchParams.set('morningNotified', String(notified));
  if (skipped > 0) url.searchParams.set('morningSkipped', String(skipped));
  if (skippedDuplicates > 0) url.searchParams.set('morningDuplicate', String(skippedDuplicates));
  url.hash = 'morning-briefing';
  return NextResponse.redirect(url);
}
