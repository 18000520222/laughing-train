import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { SESSION_COOKIE_NAME, verifyToken } from '@/lib/auth';
import { buildSalesTaskCalendar, verifyTaskCalendarToken } from '@/lib/sales-task-calendar';

export const dynamic = 'force-dynamic';

const PRIORITIES = ['URGENT', 'HIGH', 'NORMAL', 'LOW'];

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const auth = await resolveCalendarAuth(req);
  if (!auth) return new Response('unauthorized', { status: 401 });

  const dbUser = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { id: true, email: true, role: true, isActive: true },
  });
  if (!dbUser || !dbUser.isActive) return new Response('unauthorized', { status: 401 });

  const role = String(dbUser.role || '').toUpperCase();
  const canSeeAll = role === 'SUPER_ADMIN' || role === 'ADMIN';
  const scope = canSeeAll ? (url.searchParams.get('scope') || 'mine') : 'mine';
  const status = url.searchParams.get('status') === 'all' ? 'all' : 'todo';
  const priority = String(url.searchParams.get('priority') || '').toUpperCase();
  const days = clampNumber(Number(url.searchParams.get('days') || 120), 7, 365);
  const pastDays = clampNumber(Number(url.searchParams.get('pastDays') || 30), 0, 180);
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - pastDays);
  const end = new Date(now);
  end.setDate(end.getDate() + days);

  const where: any = {
    dueAt: { gte: start, lte: end },
  };
  if (status === 'todo') where.status = 'TODO';
  if (scope !== 'all') where.ownerId = dbUser.id;
  if (PRIORITIES.includes(priority)) where.priority = priority;

  const tasks = await prisma.salesTask.findMany({
    where,
    orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
    take: 1000,
    include: {
      owner: { select: { name: true, email: true } },
      company: { select: { id: true, name: true, country: true, source: true } },
      opportunity: { select: { title: true } },
    },
  });

  const scopeLabel = scope === 'all' ? '全员' : '我的';
  const body = buildSalesTaskCalendar(tasks, { scopeLabel });
  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="erdi-sales-tasks-${scope}.ics"`,
      'Cache-Control': 'no-store',
    },
  });
}

async function resolveCalendarAuth(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') || '';
  if (token) {
    const payload = verifyTaskCalendarToken(token);
    if (payload) return { userId: payload.userId };
  }

  const sessionToken = req.cookies.get(SESSION_COOKIE_NAME)?.value || '';
  if (!sessionToken) return null;
  const session = await verifyToken(sessionToken);
  if (!session?.userId) return null;
  return { userId: session.userId };
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}
