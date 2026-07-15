import { NextResponse } from 'next/server';
import { applyGmailLabelPlan } from '@/lib/email-actions';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';


export async function POST(req: Request) {
  const auth = await requireAdminUser();
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const form = await req.formData();
  const planKey = String(form.get('planKey') || '').trim();
  const apply = String(form.get('apply') || '') === 'true';
  const limit = Math.max(1, Math.min(500, parseInt(String(form.get('limit') || '100'), 10) || 100));
  if (!planKey) return redirectBack(req, { status: 'invalid', planKey, candidates: 0, tagged: 0, created: 0, cleared: 0, skipped: 0 });

  const result = await applyGmailLabelPlan({ planKey, actorUserId: auth.user.id, limit, dryRun: !apply });
  if (!result.ok) return redirectBack(req, { status: 'invalid', planKey, candidates: 0, tagged: 0, created: 0, cleared: 0, skipped: 0 });

  return redirectBack(req, {
    status: apply ? 'applied' : 'dry',
    planKey,
    candidates: result.candidates || 0,
    tagged: result.tagged || 0,
    created: result.created || 0,
    cleared: result.cleared || 0,
    skipped: result.skipped || 0,
  });
}

async function requireAdminUser() {
  const session = await getSession();
  if (!session || (session.role !== 'SUPER_ADMIN' && session.role !== 'ADMIN')) return null;
  return { user: { id: session.userId, email: session.email, name: session.name }, role: session.role };
}

function redirectBack(
  req: Request,
  result: { status: string; planKey: string; candidates: number; tagged: number; created: number; cleared: number; skipped: number }
) {
  const url = new URL('/sales-command', req.url);
  url.searchParams.set('emailLabelPlan', result.status);
  url.searchParams.set('labelPlanKey', result.planKey);
  url.searchParams.set('labelCandidates', String(result.candidates));
  url.searchParams.set('labelTagged', String(result.tagged));
  url.searchParams.set('labelCreated', String(result.created));
  url.searchParams.set('labelCleared', String(result.cleared));
  if (result.skipped > 0) url.searchParams.set('labelSkipped', String(result.skipped));
  url.hash = 'gmail-label-plan';
  return NextResponse.redirect(url, { status: 303 });
}
