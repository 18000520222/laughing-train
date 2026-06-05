import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('key') !== 'erdi-clean-2026') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const before = await prisma.emailMessage.count();

  const del = await prisma.emailMessage.deleteMany({
    where: {
      OR: [
        { messageId: { in: ['mock-1', 'mock-2'] } },
        { from: { contains: 'john@example.com' } },
        { from: { contains: 'tester@optisiv.com' } },
      ],
    },
  });

  // 同时清理可能被注入到统一收件箱的 example.com 测试消息
  const delInbox = await prisma.inboxMessage.deleteMany({
    where: { senderId: { contains: 'example.com' } },
  });

  const after = await prisma.emailMessage.count();

  return NextResponse.json({
    ok: true,
    emailMessageDeleted: del.count,
    inboxMessageDeleted: delInbox.count,
    emailMessageBefore: before,
    emailMessageAfter: after,
  });
}
