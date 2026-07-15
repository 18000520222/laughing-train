import { NextResponse } from 'next/server';
import { clearNoiseEmails, createTasksFromEmails } from '@/lib/email-actions';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { can } from '@/lib/permissions';

export const dynamic = 'force-dynamic';


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
  const session = await getSession();
  if (!session || !can(session.role, 'inbox.manage')) return null;
  return { user: { id: session.userId, email: session.email, name: session.name }, role: session.role };
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
