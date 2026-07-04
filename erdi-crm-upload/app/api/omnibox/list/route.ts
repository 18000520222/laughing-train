// app/api/omnibox/list/route.ts — 拉取统一收件箱消息(可按渠道/状态过滤)
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const channel = searchParams.get('channel') || undefined;
  const status = searchParams.get('status') || undefined;

  const where: any = { direction: 'IN' };
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
