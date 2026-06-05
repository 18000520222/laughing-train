// app/api/notifications/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';



async function currentUser() {
  const email = cookies().get('auth_email')?.value;
  if (!email) return null;
  return prisma.user.findUnique({ where: { email } });
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ items: [], unread: 0 });

  const items = await prisma.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  const unread = await prisma.notification.count({ where: { userId: user.id, isRead: false } });
  return NextResponse.json({ items, unread });
}

export async function PATCH(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (body.markAllRead) {
    await prisma.notification.updateMany({
      where: { userId: user.id, isRead: false },
      data: { isRead: true },
    });
  }
  return NextResponse.json({ ok: true });
}
