import type { SalesTaskPriority, SalesTaskType } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export const EMAIL_TASK_CATEGORIES = new Set([
  'INQUIRY',
  'QUOTE_PI',
  'ORDER_PO',
  'PAYMENT_FINANCE',
  'LOGISTICS',
  'TECH_SUPPORT',
  'CUSTOMS_COMPLIANCE',
  'MEETING_FOLLOWUP',
  'SUPPLIER_PURCHASE',
  'AUTH_SECURITY',
]);

export const EMAIL_NOISE_CATEGORIES = new Set(['SEO_SPAM', 'MARKETING_NEWSLETTER', 'PLATFORM_ALERT', 'INTERNAL', 'OTHER']);

type EmailActionSample = {
  id: string;
  subject: string;
  from: string;
  category: string;
  score: number;
  date: string;
};

export async function createTasksFromEmails(ids: string[], createdById: string) {
  const emails = await prisma.emailMessage.findMany({
    where: { id: { in: ids }, actionRequired: true, category: { in: Array.from(EMAIL_TASK_CATEGORIES) } },
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

export async function clearNoiseEmails(ids: string[]) {
  const emails = await prisma.emailMessage.findMany({
    where: { id: { in: ids }, actionRequired: true, category: { in: Array.from(EMAIL_NOISE_CATEGORIES) } },
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

export async function runEmailActionAutopilot({
  taskLimit = 20,
  noiseLimit = 50,
  sinceDays = 30,
  dryRun = true,
  actorUserId,
}: {
  taskLimit?: number;
  noiseLimit?: number;
  sinceDays?: number;
  dryRun?: boolean;
  actorUserId?: string;
} = {}) {
  const safeTaskLimit = Math.min(Math.max(taskLimit, 0), 100);
  const safeNoiseLimit = Math.min(Math.max(noiseLimit, 0), 200);
  const safeSinceDays = Math.min(Math.max(sinceDays, 1), 365);
  const since = new Date(Date.now() - safeSinceDays * 86400000);
  const actor = actorUserId
    ? await prisma.user.findUnique({ where: { id: actorUserId }, select: { id: true } })
    : await prisma.user.findFirst({
        where: { isActive: true, role: { in: ['SUPER_ADMIN', 'ADMIN'] as any } },
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
        select: { id: true },
      });

  const [taskEmails, noiseEmails] = await Promise.all([
    safeTaskLimit > 0
      ? prisma.emailMessage.findMany({
          where: {
            actionRequired: true,
            category: { in: Array.from(EMAIL_TASK_CATEGORIES) },
            date: { gte: since },
          },
          orderBy: [{ classificationScore: 'desc' }, { date: 'asc' }],
          take: safeTaskLimit,
          select: emailActionSampleSelect,
        })
      : Promise.resolve([]),
    safeNoiseLimit > 0
      ? prisma.emailMessage.findMany({
          where: {
            actionRequired: true,
            category: { in: Array.from(EMAIL_NOISE_CATEGORIES) },
            date: { gte: since },
          },
          orderBy: [{ classificationScore: 'asc' }, { date: 'asc' }],
          take: safeNoiseLimit,
          select: emailActionSampleSelect,
        })
      : Promise.resolve([]),
  ]);

  const result = {
    dryRun,
    sinceDays: safeSinceDays,
    actorReady: !!actor,
    taskCandidates: taskEmails.length,
    noiseCandidates: noiseEmails.length,
    taskSamples: taskEmails.map(normalizeEmailActionSample),
    noiseSamples: noiseEmails.map(normalizeEmailActionSample),
    createdTasks: 0,
    clearedTaskEmails: 0,
    clearedNoiseEmails: 0,
    skipped: 0,
  };

  if (dryRun) return result;
  if (!actor) return { ...result, skipped: taskEmails.length + noiseEmails.length };

  if (taskEmails.length > 0) {
    const taskResult = await createTasksFromEmails(taskEmails.map((email) => email.id), actor.id);
    result.createdTasks = taskResult.created;
    result.clearedTaskEmails = taskResult.cleared;
    result.skipped += taskResult.skipped;
  }
  if (noiseEmails.length > 0) {
    const noiseResult = await clearNoiseEmails(noiseEmails.map((email) => email.id));
    result.clearedNoiseEmails = noiseResult.cleared;
    result.skipped += noiseResult.skipped;
  }

  return result;
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
        type: EMAIL_TASK_CATEGORIES.has(email.category) && email.category !== 'AUTH_SECURITY' ? 'INQUIRY' : 'PROSPECT',
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

const emailActionSampleSelect = {
  id: true,
  from: true,
  subject: true,
  category: true,
  classificationScore: true,
  date: true,
} as const;

function normalizeEmailActionSample(email: {
  id: string;
  from: string;
  subject: string | null;
  category: string;
  classificationScore: number;
  date: Date;
}): EmailActionSample {
  return {
    id: email.id,
    subject: email.subject || '无主题',
    from: trimSender(email.from),
    category: email.category,
    score: email.classificationScore,
    date: email.date.toISOString(),
  };
}

function taskTitle(email: { category: string; subject: string | null; from: string }) {
  const label: Record<string, string> = {
    INQUIRY: '回复询盘邮件',
    QUOTE_PI: '处理报价/PI邮件',
    ORDER_PO: '处理订单/PO邮件',
    PAYMENT_FINANCE: '处理付款财务邮件',
    LOGISTICS: '处理物流邮件',
    TECH_SUPPORT: '处理技术售后邮件',
    CUSTOMS_COMPLIANCE: '处理海关合规邮件',
    MEETING_FOLLOWUP: '处理会议跟进邮件',
    SUPPLIER_PURCHASE: '处理供应采购邮件',
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
  if (category === 'PAYMENT_FINANCE' || category === 'LOGISTICS' || category === 'CUSTOMS_COMPLIANCE' || category === 'SUPPLIER_PURCHASE' || category === 'AUTH_SECURITY') return 'GENERAL';
  return 'EMAIL';
}

function taskPriority(category: string, score: number, date: Date): SalesTaskPriority {
  const ageHours = Math.floor((Date.now() - date.getTime()) / 3600000);
  if (ageHours >= 48 || category === 'ORDER_PO' || category === 'AUTH_SECURITY') return 'URGENT';
  if (category === 'QUOTE_PI' || category === 'INQUIRY' || category === 'CUSTOMS_COMPLIANCE' || score >= 85) return 'HIGH';
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
