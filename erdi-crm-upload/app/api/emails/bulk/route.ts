import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { clearNoiseEmails, createTasksFromEmails } from '@/lib/email-actions';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'SALES']);

export async function POST(req: Request) {
  const auth = await requireEmailActionUser();
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const form = await req.formData();
  const action = String(form.get('action') || '');
  const ids = parseIds(form.get('ids'));
  if (ids.length === 0) return redirectBack(req, 'empty', 0);

  if (action === 'create_tasks') {
    const result = await createTasksFromEmails(ids, auth.user.id);
    return redirectBack(req, 'tasks', result.created, result.cleared, result.skipped);
  }
  if (action === 'clear_noise') {
    const result = await clearNoiseEmails(ids);
    return redirectBack(req, 'cleared', 0, result.cleared, result.skipped);
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}

async function requireEmailActionUser() {
  const cookieStore = cookies();
  const role = (cookieStore.get('auth_role')?.value || '').toUpperCase();
  const email = cookieStore.get('auth_email')?.value || '';
  const userId = cookieStore.get('auth_userId')?.value || '';
  if (!ALLOWED_ROLES.has(role)) return null;

  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : email
    ? await prisma.user.findUnique({ where: { email } })
    : null;
  if (!user || !user.isActive) return null;
  return { user, role };
}

function parseIds(value: FormDataEntryValue | null) {
  return Array.from(
    new Set(
      String(value || '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
    )
  ).slice(0, 100);
}

function redirectBack(req: Request, bulk: string, created: number, cleared = 0, skipped = 0) {
  const url = new URL('/sales-command', req.url);
  url.searchParams.set('emailBulk', bulk);
  url.searchParams.set('created', String(created));
  url.searchParams.set('cleared', String(cleared));
  if (skipped > 0) url.searchParams.set('skipped', String(skipped));
  return NextResponse.redirect(url, { status: 303 });
}
