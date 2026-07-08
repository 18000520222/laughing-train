import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { InboxStatus, SalesTaskPriority } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'SALES']);
const PENDING_STATUSES: InboxStatus[] = ['NEW', 'AI_DRAFTED'];
const LOW_VALUE_INTENTS = new Set(['SPAM', 'GREETING', 'OTHER']);

export async function POST(req: Request) {
  const auth = await requireOmniboxUser();
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const form = await req.formData();
  const action = String(form.get('action') || '');
  const ids = parseIds(form.get('ids'));
  if (ids.length === 0) return redirectBack(req, 'empty', 0);

  if (action === 'create_tasks') {
    const result = await createTasksFromInbox(ids, auth.user.id);
    return redirectBack(req, 'tasks', result.created, result.skipped);
  }
  if (action === 'claim') {
    const result = await claimLinkedCompanies(ids, auth.user.id);
    return redirectBack(req, 'claimed', result.updated, result.skipped);
  }
  if (action === 'archive') {
    const result = await archiveLowValueInbox(ids);
    return redirectBack(req, 'archived', result.updated, result.skipped);
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}

async function requireOmniboxUser() {
  const cookieStore = cookies();
  const role = (cookieStore.get('auth_role')?.value || '').toUpperCase();
  const email = cookieStore.get('auth_email')?.value || '';
  const userId = cookieStore.get('auth_userId')?.value || '';
  if (!ALLOWED_ROLES.has(role)) return null;

  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : email
    ? await prisma.user.findUnique({ where: { email } })
    : null;
  if (!user || !user.isActive) return null;
  return { user, role };
}

async function createTasksFromInbox(ids: string[], createdById: string) {
  const messages = await prisma.inboxMessage.findMany({
    where: { id: { in: ids }, direction: 'IN', status: { in: PENDING_STATUSES }, companyId: { not: null } },
    include: { company: { select: { id: true, name: true, ownerId: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const dueAt = new Date();
  dueAt.setHours(dueAt.getHours() + 24);

  let created = 0;
  let skipped = ids.length - messages.length;
  for (const message of messages) {
    if (!message.companyId || !message.company?.ownerId) {
      skipped++;
      continue;
    }
    const sourceRef = `inbox:${message.id}`;
    const existing = await prisma.salesTask.findFirst({
      where: { source: 'OMNIBOX_BULK', sourceRef, status: 'TODO' },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      continue;
    }

    await prisma.salesTask.create({
      data: {
        title: `回复${channelLabel(message.channel)}客户: ${message.senderName || message.senderId}`,
        description: buildTaskDescription(message),
        type: 'EMAIL',
        priority: priorityForMessage(message.intent, message.sentAt || message.createdAt),
        dueAt,
        ownerId: message.company.ownerId,
        createdById,
        companyId: message.companyId,
        source: 'OMNIBOX_BULK',
        sourceRef,
      },
    });
    await prisma.notification.create({
      data: {
        userId: message.company.ownerId,
        type: 'SYSTEM',
        title: '收件箱消息已转销售任务',
        body: `${message.company.name}: ${message.senderName || message.senderId}`,
        link: '/tasks?view=week',
      },
    });
    created++;
  }

  return { created, skipped };
}

async function claimLinkedCompanies(ids: string[], ownerId: string) {
  const rows = await prisma.inboxMessage.findMany({
    where: { id: { in: ids }, direction: 'IN', status: { in: PENDING_STATUSES }, companyId: { not: null } },
    include: { company: { select: { id: true, ownerId: true } } },
  });
  const companyIds = Array.from(new Set(rows.map((row) => row.company?.id).filter(Boolean))) as string[];
  if (companyIds.length === 0) return { updated: 0, skipped: ids.length };

  const result = await prisma.company.updateMany({
    where: { id: { in: companyIds }, ownerId: null },
    data: { ownerId },
  });
  return { updated: result.count, skipped: Math.max(0, ids.length - result.count) };
}

async function archiveLowValueInbox(ids: string[]) {
  const rows = await prisma.inboxMessage.findMany({
    where: { id: { in: ids }, direction: 'IN', status: { in: PENDING_STATUSES } },
    select: { id: true, intent: true },
  });
  const archiveIds = rows.filter((row) => LOW_VALUE_INTENTS.has(String(row.intent || ''))).map((row) => row.id);
  if (archiveIds.length === 0) return { updated: 0, skipped: ids.length };

  const result = await prisma.inboxMessage.updateMany({
    where: { id: { in: archiveIds }, direction: 'IN', status: { in: PENDING_STATUSES } },
    data: { status: 'ARCHIVED' },
  });
  return { updated: result.count, skipped: Math.max(0, ids.length - result.count) };
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

function redirectBack(req: Request, bulk: string, count: number, skipped = 0) {
  const url = new URL('/omnibox', req.url);
  url.searchParams.set('bulk', bulk);
  url.searchParams.set('count', String(count));
  if (skipped > 0) url.searchParams.set('skipped', String(skipped));
  return NextResponse.redirect(url, { status: 303 });
}

function priorityForMessage(intent: string | null, sentAt: Date): SalesTaskPriority {
  const ageHours = Math.floor((Date.now() - sentAt.getTime()) / 3600000);
  if (ageHours >= 24 || intent === 'COMPLAINT') return 'URGENT';
  if (['PRICE_INQUIRY', 'SAMPLE_REQUEST', 'ORDER_STATUS', 'PRODUCT_QUESTION'].includes(String(intent || ''))) return 'HIGH';
  return 'NORMAL';
}

function buildTaskDescription(message: {
  channel: string;
  senderId: string;
  senderName: string | null;
  originalText: string;
  translatedText: string | null;
  intent: string | null;
  aiReplyZh: string | null;
}) {
  return [
    `来源渠道: ${channelLabel(message.channel)}`,
    `客户: ${message.senderName || message.senderId}`,
    `意图: ${message.intent || '未识别'}`,
    '',
    '客户原文:',
    message.originalText,
    '',
    '中文翻译:',
    message.translatedText || '-',
    '',
    'AI回复草稿:',
    message.aiReplyZh || '-',
  ].join('\n');
}

function channelLabel(channel: string) {
  const labels: Record<string, string> = {
    EMAIL: '邮件',
    WHATSAPP: 'WhatsApp',
    ALIBABA: '阿里国际站',
    AMAZON: '亚马逊',
    SHOPEE: '虾皮',
    FACEBOOK: 'Facebook',
    INSTAGRAM: 'Instagram',
    LINKEDIN: 'LinkedIn',
    SALESMARTLY: 'SaleSmartly',
    CHATWOOT: 'Chatwoot',
  };
  return labels[channel] || channel;
}
