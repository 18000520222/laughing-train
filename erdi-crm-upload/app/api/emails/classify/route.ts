import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { classifyEmail } from '@/lib/email-classifier';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const role = (cookies().get('auth_role')?.value || '').toUpperCase();
  if (role === 'SUPER_ADMIN' || role === 'ADMIN') return true;
  const { searchParams } = new URL(req.url);
  if (searchParams.get('key') === (process.env.MAIL_CRON_KEY || 'erdi-mail-2026')) return true;
  const auth = req.headers.get('authorization') || '';
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  return false;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '500', 10) || 500, 1), 2000);
  const includeClassified = searchParams.get('all') === '1';

  const where = includeClassified ? {} : { category: 'UNCLASSIFIED' };
  const messages = await prisma.emailMessage.findMany({
    where,
    orderBy: { date: 'desc' },
    take: limit,
    select: { id: true, from: true, subject: true, textBody: true, htmlBody: true },
  });

  const counts: Record<string, number> = {};
  let actionRequired = 0;
  let leads = 0;

  for (const msg of messages) {
    const classification = classifyEmail(msg);
    counts[classification.category] = (counts[classification.category] || 0) + 1;
    if (classification.actionRequired) actionRequired++;
    if (classification.isLead) leads++;

    await prisma.emailMessage.update({
      where: { id: msg.id },
      data: {
        isLead: classification.isLead,
        category: classification.category,
        categoryReason: classification.categoryReason,
        classificationScore: classification.classificationScore,
        actionRequired: classification.actionRequired,
        classifiedAt: new Date(),
        classificationTags: classification.classificationTags,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    scanned: messages.length,
    actionRequired,
    leads,
    counts,
  });
}
