import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { SalesTaskPriority, SalesTaskType } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'SALES']);
const TASK_CATEGORIES = new Set(['INQUIRY', 'QUOTE_PI', 'ORDER_PO', 'PAYMENT_FINANCE', 'LOGISTICS', 'TECH_SUPPORT', 'AUTH_SECURITY']);
const NOISE_CATEGORIES = new Set(['SEO_SPAM', 'MARKETING_NEWSLETTER', 'PLATFORM_ALERT', 'INTERNAL', 'OTHER']);

export async function POST(req: Request) {
  const auth = await requireEmailActionUser();
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const form = await req.formData();
  const action = String(form.get('action') || '');
  const ids = parseIds(form.get('ids'));
  if (ids.length === 0) return redirectBack(req, 'empty', 0);

  if (action === 'create_tasks') {
    const result = await createTasksFromEmails(ids, auth.user.id);
    return redirectBack(req, 'tasks', result.created, result.cleared, result.skipped);
  }
  if (action === 'clear_noise') {
    const result = await clearNoiseEmails(ids);
    return redirectBack(req, 'cleared', 0, result.cleared, result.skipped);
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}

async function requireEmailActionUser() {
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

async function createTasksFromEmails(ids: string[], createdById: string) {
  const emails = await prisma.emailMessage.findMany({
    where: { id: { in: ids }, actionRequired: true, category: { in: Array.from(TASK_CATEGORIES) } },
    include: { account: { select: { email: true } } },
    orderBy: { date: 'asc' },
  });

  let created = 0;
  let cleared = 0;
  let skipped = ids.length - emails.length;
  for (const email of emails) {
    const sourceRef = `email:${email.id}`;
    const existing = await prisma.salesTask.findFirst({
      where: { source: 'EMAIL_ACTION_BULK', sourceRef, status: 'TODO' },
      select: { id: true },
    });
    if (existing) {
      await markEmailCleared(email.id, '已转任务');
      cleared++;
      skipped++;
      continue;
    }

    const company = await findOrCreateEmailCompany(email, createdById);
    if (!company) {
      skipped++;
      continue;
    }
    const ownerId = company.ownerId || createdById;
    if (!company.ownerId) {
      await prisma.company.update({ where: { id: company.id }, data: { ownerId } });
    }

    const dueAt = new Date();
    dueAt.setHours(dueAt.getHours() + dueHoursForCategory(email.category));
    await prisma.salesTask.create({
      data: {
        title: taskTitle(email),
        description: taskDescription(email, company.name),
        type: taskType(email.category),
        priority: taskPriority(email.category, email.classificationScore, email.date),
        dueAt,
        ownerId,
        createdById,
        companyId: company.id,
        source: 'EMAIL_ACTION_BULK',
        sourceRef,
      },
    });
    await prisma.notification.create({
      data: {
        userId: ownerId,
        type: 'EMAIL',
        title: '邮件已转销售任务',
        body: `${company.name}: ${email.subject || '无主题'}`,
        link: '/tasks?view=week',
      },
    });
    await markEmailCleared(email.id, '已转任务');
    created++;
    cleared++;
  }

  return { created, cleared, skipped };
}

async function clearNoiseEmails(ids: string[]) {
  const emails = await prisma.emailMessage.findMany({
    where: { id: { in: ids }, actionRequired: true, category: { in: Array.from(NOISE_CATEGORIES) } },
    select: { id: true, classificationTags: true },
  });
  let cleared = 0;
  for (const email of emails) {
    await prisma.emailMessage.update({
      where: { id: email.id },
      data: {
        actionRequired: false,
        classifiedAt: new Date(),
        classificationTags: mergeTags(email.classificationTags, ['已清理']),
      },
    });
    cleared++;
  }
  return { cleared, skipped: Math.max(0, ids.length - cleared) };
}

async function markEmailCleared(id: string, tag: string) {
  const email = await prisma.emailMessage.findUnique({
    where: { id },
    select: { classificationTags: true },
  });
  if (!email) return;
  await prisma.emailMessage.update({
    where: { id },
    data: {
      actionRequired: false,
      classifiedAt: new Date(),
      classificationTags: mergeTags(email.classificationTags, [tag]),
    },
  });
}

async function findOrCreateEmailCompany(
  email: {
    from: string;
    subject: string | null;
    category: string;
  },
  ownerId: string
) {
  const parsed = parseSender(email.from);
  if (parsed.email) {
    const contact = await prisma.contact.findUnique({
      where: { email: parsed.email },
      include: { company: true },
    });
    if (contact?.company) return contact.company;
  }

  const companyName = guessCompanyName(parsed, email.category);
  let company = await prisma.company.findFirst({ where: { name: companyName } });
  if (!company) {
    company = await prisma.company.create({
      data: {
        name: companyName,
        source: email.category === 'AUTH_SECURITY' ? 'EMAIL_AUTH' : 'GMAIL_INBOX',
        type: TASK_CATEGORIES.has(email.category) && email.category !== 'AUTH_SECURITY' ? 'INQUIRY' : 'PROSPECT',
        ownerId,
        customerProfile: `由邮件动作清理台自动建档。来源:${email.from}; 主题:${email.subject || '无主题'}`,
      },
    });
  }

  if (parsed.email) {
    const nameParts = splitName(parsed.name || parsed.email.split('@')[0]);
    await prisma.contact
      .create({
        data: {
          firstName: nameParts.firstName,
          lastName: nameParts.lastName || undefined,
          email: parsed.email,
          companyId: company.id,
        },
      })
      .catch(async () => {
        const contact = await prisma.contact.findUnique({ where: { email: parsed.email } });
        if (contact && contact.companyId !== company.id) {
          await prisma.contact.update({ where: { id: contact.id }, data: { companyId: company.id } });
        }
      });
  }

  return company;
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

function redirectBack(req: Request, bulk: string, created: number, cleared = 0, skipped = 0) {
  const url = new URL('/sales-command', req.url);
  url.searchParams.set('emailBulk', bulk);
  url.searchParams.set('created', String(created));
  url.searchParams.set('cleared', String(cleared));
  if (skipped > 0) url.searchParams.set('skipped', String(skipped));
  return NextResponse.redirect(url, { status: 303 });
}

function taskTitle(email: { category: string; subject: string | null; from: string }) {
  const label: Record<string, string> = {
    INQUIRY: '回复询盘邮件',
    QUOTE_PI: '处理报价/PI邮件',
    ORDER_PO: '处理订单/PO邮件',
    PAYMENT_FINANCE: '处理付款财务邮件',
    LOGISTICS: '处理物流邮件',
    TECH_SUPPORT: '处理技术售后邮件',
    AUTH_SECURITY: '处理安全验证码邮件',
  };
  return `${label[email.category] || '处理邮件'}: ${email.subject || trimSender(email.from)}`;
}

function taskDescription(
  email: {
    account: { email: string };
    from: string;
    to: string;
    subject: string | null;
    category: string;
    categoryReason: string | null;
    classificationScore: number;
    classificationTags: string[];
    date: Date;
    textBody: string | null;
  },
  companyName: string
) {
  return [
    `客户/对象: ${companyName}`,
    `收件账号: ${email.account.email}`,
    `发件人: ${email.from}`,
    `收件人: ${email.to}`,
    `主题: ${email.subject || '无主题'}`,
    `分类: ${email.category} · 分数 ${email.classificationScore}`,
    `原因: ${email.categoryReason || '-'}`,
    `标签: ${email.classificationTags.join(', ') || '-'}`,
    `邮件日期: ${email.date.toISOString()}`,
    '',
    '正文摘要:',
    trimBody(email.textBody || ''),
  ].join('\n');
}

function taskType(category: string): SalesTaskType {
  if (category === 'QUOTE_PI' || category === 'ORDER_PO') return 'QUOTE';
  if (category === 'TECH_SUPPORT') return 'TECH_CHECK';
  if (category === 'PAYMENT_FINANCE' || category === 'LOGISTICS' || category === 'AUTH_SECURITY') return 'GENERAL';
  return 'EMAIL';
}

function taskPriority(category: string, score: number, date: Date): SalesTaskPriority {
  const ageHours = Math.floor((Date.now() - date.getTime()) / 3600000);
  if (ageHours >= 48 || category === 'ORDER_PO' || category === 'AUTH_SECURITY') return 'URGENT';
  if (category === 'QUOTE_PI' || category === 'INQUIRY' || score >= 85) return 'HIGH';
  return 'NORMAL';
}

function dueHoursForCategory(category: string) {
  if (category === 'AUTH_SECURITY') return 2;
  if (category === 'ORDER_PO' || category === 'QUOTE_PI') return 12;
  return 24;
}

function parseSender(from: string) {
  const match = from.match(/(.*)<([^>]+)>/);
  const rawEmail = match ? match[2] : from.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0] || '';
  const email = rawEmail.trim().toLowerCase();
  const name = (match ? match[1] : from.replace(rawEmail, '')).replace(/["']/g, '').trim();
  const domain = email.includes('@') ? email.split('@')[1] : '';
  return { email, name, domain };
}

function guessCompanyName(parsed: { email: string; name: string; domain: string }, category: string) {
  if (category === 'AUTH_SECURITY') return 'ERDI 邮件与平台安全';
  const freeMail = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'qq.com', '163.com', '126.com', 'mail.ru']);
  if (parsed.domain && !freeMail.has(parsed.domain)) {
    const root = parsed.domain.split('.').filter(Boolean)[0] || parsed.domain;
    return root.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return parsed.name || (parsed.email ? parsed.email.split('@')[0] : '邮件线索客户');
}

function splitName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || name || 'Unknown',
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : null,
  };
}

function mergeTags(current: string[], extra: string[]) {
  return Array.from(new Set([...(current || []), ...extra]));
}

function trimSender(from: string) {
  return from.replace(/\s+/g, ' ').trim().slice(0, 80);
}

function trimBody(body: string) {
  return body.replace(/\s+/g, ' ').trim().slice(0, 1200) || '-';
}
