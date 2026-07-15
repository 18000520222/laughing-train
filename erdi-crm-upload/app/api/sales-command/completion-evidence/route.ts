import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createCompletionEvidenceRepairTasks } from '@/lib/sales-completion-evidence-repair';
import { getSession } from '@/lib/auth';
import { can } from '@/lib/permissions';

export const dynamic = 'force-dynamic';


export async function POST(req: Request) {
  const auth = await requireSalesUser();
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const form = await req.formData();
  const taskIds = parseTaskIds(form);
  if (taskIds.length === 0) return redirectBack(req, 'invalid', 0, 0);

  const result = await createCompletionEvidenceRepairTasks({ taskIds, currentUserId: auth.user.id, role: auth.role });
  return redirectBack(req, result.created > 0 ? 'created' : 'duplicate', result.created, result.skipped);
}

async function requireSalesUser() {
  const session = await getSession();
  if (!session || !can(session.role, 'sales.manage')) return null;
  return { user: { id: session.userId, email: session.email, name: session.name }, role: session.role };
}

function parseTaskIds(form: FormData) {
  const values = [
    String(form.get('taskId') || ''),
    String(form.get('taskIds') || ''),
    ...form.getAll('taskIds').map((value) => String(value || '')),
  ];
  return Array.from(
    new Set(
      values
        .flatMap((value) => value.split(','))
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ).slice(0, 50);
}

function redirectBack(req: Request, status: string, created: number, skipped: number) {
  const url = new URL('/sales-command', req.url);
  url.searchParams.set('completionEvidence', status);
  url.searchParams.set('completionCreated', String(created));
  if (skipped > 0) url.searchParams.set('completionSkipped', String(skipped));
  url.hash = 'completion-evidence';
  return NextResponse.redirect(url);
}
