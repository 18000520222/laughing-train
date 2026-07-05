import { prisma } from '@/lib/prisma';

const SECURITY_CATEGORY = 'AUTH_SECURITY';
const STALE_SECURITY_HOURS = 24;
const SECURITY_ARCHIVED_TAG = '安全已归档';

export type EmailSecuritySignal = 'verification_code' | 'suspicious_login' | 'password_or_account' | 'workspace_security' | 'general_security';

export async function buildEmailSecurityAudit({ sampleLimit = 8, now = new Date() }: { sampleLimit?: number; now?: Date } = {}) {
  const staleBefore = new Date(now.getTime() - STALE_SECURITY_HOURS * 3600000);
  const [total, pending, stalePending, recentMessages, staleMessages, providerRows] = await Promise.all([
    prisma.emailMessage.count({ where: { category: SECURITY_CATEGORY } }),
    prisma.emailMessage.count({ where: { category: SECURITY_CATEGORY, actionRequired: true } }),
    prisma.emailMessage.count({ where: { category: SECURITY_CATEGORY, actionRequired: true, date: { lt: staleBefore } } }),
    prisma.emailMessage.findMany({
      where: { category: SECURITY_CATEGORY },
      orderBy: { date: 'desc' },
      take: sampleLimit,
      select: securityEmailSelect,
    }),
    prisma.emailMessage.findMany({
      where: { category: SECURITY_CATEGORY, actionRequired: true, date: { lt: staleBefore } },
      orderBy: { date: 'asc' },
      take: sampleLimit,
      select: securityEmailSelect,
    }),
    prisma.emailMessage.findMany({
      where: { category: SECURITY_CATEGORY },
      orderBy: { date: 'desc' },
      take: 300,
      select: { from: true, subject: true, textBody: true, htmlBody: true },
    }),
  ]);

  const signals = summarizeSignals(providerRows);
  const providers = summarizeProviders(providerRows.map((row) => row.from));

  return {
    total,
    pending,
    stalePending,
    activePending: Math.max(0, pending - stalePending),
    staleHours: STALE_SECURITY_HOURS,
    recentMessages: recentMessages.map(normalizeSecurityEmail),
    staleMessages: staleMessages.map(normalizeSecurityEmail),
    providers,
    signals,
    recommendation: securityRecommendation({ total, pending, stalePending }),
  };
}

export async function runEmailSecurityWatch({
  dryRun = true,
  limit = 50,
  now = new Date(),
}: {
  dryRun?: boolean;
  limit?: number;
  now?: Date;
} = {}) {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const staleBefore = new Date(now.getTime() - STALE_SECURITY_HOURS * 3600000);
  const staleMessages = await prisma.emailMessage.findMany({
    where: { category: SECURITY_CATEGORY, actionRequired: true, date: { lt: staleBefore } },
    orderBy: { date: 'asc' },
    take: safeLimit,
    select: securityEmailSelect,
  });
  const admins = await prisma.user.findMany({
    where: { isActive: true, role: { in: ['SUPER_ADMIN', 'ADMIN'] as any } },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  const freshPending = await prisma.emailMessage.findMany({
    where: { category: SECURITY_CATEGORY, actionRequired: true, date: { gte: staleBefore } },
    orderBy: { date: 'desc' },
    take: 10,
    select: securityEmailSelect,
  });

  const result = {
    dryRun,
    staleHours: STALE_SECURITY_HOURS,
    staleCandidates: staleMessages.length,
    freshPending: freshPending.length,
    adminCount: admins.length,
    archived: 0,
    adminNotifications: 0,
    skippedDuplicates: 0,
    staleSamples: staleMessages.map(normalizeSecurityEmail),
    freshSamples: freshPending.map(normalizeSecurityEmail),
  };

  if (dryRun) return result;

  for (const email of staleMessages) {
    await prisma.emailMessage.update({
      where: { id: email.id },
      data: {
        actionRequired: false,
        classifiedAt: now,
        classificationTags: mergeTags(email.classificationTags, [SECURITY_ARCHIVED_TAG]),
      },
    });
    result.archived++;
  }

  for (const email of freshPending) {
    for (const admin of admins) {
      const created = await createSecurityNotification({
        userId: admin.id,
        emailId: email.id,
        subject: email.subject || '无主题',
        signalLabel: signalLabel(detectSecuritySignal(email)),
      });
      if (created) result.adminNotifications++;
      else result.skippedDuplicates++;
    }
  }

  return result;
}

const securityEmailSelect = {
  id: true,
  from: true,
  subject: true,
  date: true,
  categoryReason: true,
  classificationScore: true,
  actionRequired: true,
  classificationTags: true,
  textBody: true,
  htmlBody: true,
  account: { select: { email: true } },
} as const;

function normalizeSecurityEmail(email: {
  id: string;
  from: string;
  subject: string | null;
  date: Date;
  categoryReason: string | null;
  classificationScore: number;
  actionRequired: boolean;
  classificationTags: string[];
  textBody: string | null;
  htmlBody: string | null;
  account: { email: string };
}) {
  const signal = detectSecuritySignal(email);
  return {
    id: email.id,
    from: trimSender(email.from),
    subject: email.subject || '无主题',
    accountEmail: email.account.email,
    dateLabel: email.date.toLocaleString('zh-CN'),
    ageHours: Math.max(0, Math.floor((Date.now() - email.date.getTime()) / 3600000)),
    reason: email.categoryReason || '-',
    score: email.classificationScore,
    actionRequired: email.actionRequired,
    signal,
    signalLabel: signalLabel(signal),
    tags: email.classificationTags,
  };
}

function detectSecuritySignal(input: { from: string; subject: string | null; textBody: string | null; htmlBody: string | null }): EmailSecuritySignal {
  const text = `${input.from}\n${input.subject || ''}\n${input.textBody || input.htmlBody || ''}`.toLowerCase().replace(/\s+/g, ' ');
  if (['verification code', 'security code', '验证码', '安全码', '2fa', 'two-factor'].some((word) => text.includes(word))) return 'verification_code';
  if (['suspicious', 'unusual sign-in', 'new sign-in', 'new login', '可疑', '异常登录'].some((word) => text.includes(word))) return 'suspicious_login';
  if (['password', 'recovery', 'account changed', '账号', '密码', '恢复'].some((word) => text.includes(word))) return 'password_or_account';
  if (['slack', 'google workspace', 'microsoft', 'github', 'cloudflare'].some((word) => text.includes(word))) return 'workspace_security';
  return 'general_security';
}

function summarizeSignals(rows: Array<{ from: string; subject: string | null; textBody: string | null; htmlBody: string | null }>) {
  const counts = new Map<EmailSecuritySignal, number>();
  for (const row of rows) {
    const signal = detectSecuritySignal(row);
    counts.set(signal, (counts.get(signal) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([signal, count]) => ({ signal, label: signalLabel(signal), count }))
    .sort((a, b) => b.count - a.count);
}

function summarizeProviders(fromRows: string[]) {
  const counts = new Map<string, number>();
  for (const from of fromRows) {
    const provider = providerName(from);
    counts.set(provider, (counts.get(provider) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([provider, count]) => ({ provider, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

function providerName(from: string) {
  const text = from.toLowerCase();
  if (text.includes('slack')) return 'Slack';
  if (text.includes('google')) return 'Google';
  if (text.includes('microsoft')) return 'Microsoft';
  if (text.includes('github')) return 'GitHub';
  if (text.includes('cloudflare')) return 'Cloudflare';
  const match = text.match(/@([a-z0-9.-]+\.[a-z]{2,})/i);
  return match?.[1] || '其他';
}

function signalLabel(signal: EmailSecuritySignal) {
  const labels: Record<EmailSecuritySignal, string> = {
    verification_code: '验证码/2FA',
    suspicious_login: '可疑登录',
    password_or_account: '密码/账号变更',
    workspace_security: '工作区安全',
    general_security: '一般安全提醒',
  };
  return labels[signal];
}

function securityRecommendation(input: { total: number; pending: number; stalePending: number }) {
  if (input.total === 0) return '暂无安全邮件。邮箱同步恢复后,验证码和登录提醒会进入这里统一审计。';
  if (input.stalePending > 0) return `有 ${input.stalePending} 封超过 ${STALE_SECURITY_HOURS} 小时的安全邮件,建议归档,避免过期验证码占用待动作队列。`;
  if (input.pending > 0) return `有 ${input.pending} 封近期安全邮件待确认,优先核对是否本人登录、是否需要改密码或开启 2FA。`;
  return '安全邮件队列已清空。继续保持验证码不进入销售自动驾驶。';
}

async function createSecurityNotification(input: { userId: string; emailId: string; subject: string; signalLabel: string }) {
  const title = `安全邮件提醒:${input.signalLabel}`;
  const link = '/sales-command#email-security-audit';
  const existing = await prisma.notification.findFirst({
    where: {
      userId: input.userId,
      type: 'SYSTEM',
      title,
      link,
      body: { contains: input.emailId },
    },
    select: { id: true },
  });
  if (existing) return false;

  await prisma.notification.create({
    data: {
      userId: input.userId,
      type: 'SYSTEM',
      title,
      body: `安全邮件: ${input.subject}\n邮件ID: ${input.emailId}\n请确认是否本人操作,必要时修改密码或开启 2FA。`,
      link,
    },
  });
  return true;
}

function mergeTags(current: string[], extra: string[]) {
  return Array.from(new Set([...(current || []), ...extra]));
}

function trimSender(from: string) {
  return from.replace(/\s+/g, ' ').trim().slice(0, 80);
}
