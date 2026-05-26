// app/api/notifications/[id]/route.ts
import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function PATCH(_req: Request, { params }: { params: { id: string } }) {
  await prisma.notification.update({
    where: { id: params.id },
    data: { isRead: true },
  });
  return NextResponse.json({ ok: true });
}
