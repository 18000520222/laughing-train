// app/api/omnibox/list/route.ts — 拉取统一收件箱消息(可按渠道/状态过滤)
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { inboxAccessWhere } from '@/lib/data-access';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !can(session.role, 'inbox.manage')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const channel = searchParams.get('channel') || undefined;
  const status = searchParams.get('status') || undefined;

  const where: any = { direction: 'IN', AND: [inboxAccessWhere(session)] };
  if (channel) where.channel = channel;
  if (status) where.status = status;

  const messages = await prisma.inboxMessage.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { company: { select: { id: true, name: true, country: true, customerCode: true, owner: { select: { name: true, email: true } } } } },
  });

  return NextResponse.json({ ok: true, messages });
}
