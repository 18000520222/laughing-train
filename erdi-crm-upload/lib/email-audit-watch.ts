import { prisma } from '@/lib/prisma';
import { buildEmailClassificationAudit } from '@/lib/email-audit';

const EMAIL_AUDIT_RULES = {
  actionBacklog: 25,
  lowConfidenceBacklog: 20,
  unclassifiedBacklog: 1,
} as const;

type EmailAuditAlert = {
  key: 'NO_MAIL_DATA' | 'ACTION_BACKLOG' | 'LOW_CONFIDENCE_BACKLOG' | 'UNCLASSIFIED_BACKLOG' | 'NO_ACTIVE_ACCOUNT';
  title: string;
  body: string;
  action: string;
};

export async function runEmailAuditWatch(options: { limit?: number; now?: Date } = {}) {
  const now = options.now || new Date();
  const todayStart = startOfUtcDay(now);
  const limit = Math.min(Math.max(options.limit || 100, 1), 500);
  const audit = await buildEmailClassificationAudit({ sampleLimit: 5 });
  const admins = await prisma.user.findMany({
    where: { isActive: true, role: { in: ['SUPER_ADMIN', 'ADMIN'] as any } },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  const alerts = buildEmailAuditAlerts(audit);

  const result = {
    total: audit.total,
    actionRequired: audit.actionRequired,
    leads: audit.leads,
    unclassified: audit.unclassified,
    lowConfidence: audit.lowConfidence,
    staleUnclassified: audit.staleUnclassified,
    adminCount: admins.length,
    alerts: alerts.length,
    adminNotifications: 0,
    skippedDuplicates: 0,
    skippedLimit: 0,
  };

  for (const alert of alerts) {
    for (const admin of admins) {
      if (result.adminNotifications >= limit) {
        result.skippedLimit++;
        break;
      }
      const created = await createDailyNotification({
        userId: admin.id,
        title: `邮件分类提醒:${alert.title}`,
        body: `${alert.body}\n建议:${alert.action}`,
        link: '/sales-command',
        todayStart,
      });
      if (created) result.adminNotifications++;
      else result.skippedDuplicates++;
    }
  }

  return result;
}

function buildEmailAuditAlerts(audit: Awaited<ReturnType<typeof buildEmailClassificationAudit>>): EmailAuditAlert[] {
  const alerts: EmailAuditAlert[] = [];
  const activeAccounts = audit.accounts.filter((account) => account.isActive);
  if (activeAccounts.length === 0) {
    alerts.push({
      key: 'NO_ACTIVE_ACCOUNT',
      title: '没有启用邮箱账号',
      body: 'CRM 当前没有启用的同步邮箱账号,邮件入口不会自动沉淀到客户和商机。',
      action: '进入渠道接入或系统设置检查邮箱账号,恢复 Gmail/IMAP 同步。',
    });
  }
  if (audit.total === 0) {
    alerts.push({
      key: 'NO_MAIL_DATA',
      title: '邮件表暂无数据',
      body: 'CRM 邮件表暂无可审计数据,销售无法从邮件入口自动发现询盘、报价和订单。',
      action: '先恢复邮箱同步,然后执行邮件分类重跑。',
    });
  }
  if (audit.actionRequired >= EMAIL_AUDIT_RULES.actionBacklog) {
    alerts.push({
      key: 'ACTION_BACKLOG',
      title: '待处理邮件积压',
      body: `当前有 ${audit.actionRequired} 封邮件需要销售动作,其中线索邮件 ${audit.leads} 封。`,
      action: '进入销售指挥台的邮件分类审计,优先处理询盘、报价、订单和财务邮件。',
    });
  }
  if (audit.lowConfidence >= EMAIL_AUDIT_RULES.lowConfidenceBacklog) {
    alerts.push({
      key: 'LOW_CONFIDENCE_BACKLOG',
      title: '低置信分类积压',
      body: `当前有 ${audit.lowConfidence} 封低置信邮件,容易把客户邮件混进其他/营销/平台通知。`,
      action: '检查复核队列,把误判关键词补进分类器或重跑最近 500 封。',
    });
  }
  if (audit.unclassified >= EMAIL_AUDIT_RULES.unclassifiedBacklog || audit.staleUnclassified > 0) {
    alerts.push({
      key: 'UNCLASSIFIED_BACKLOG',
      title: '未分类邮件未清空',
      body: `当前未分类 ${audit.unclassified} 封,其中超过 2 天未分类 ${audit.staleUnclassified} 封。`,
      action: '点击“重跑未分类 500 封”,再检查邮件同步和分类 cron。',
    });
  }
  return alerts;
}

async function createDailyNotification(input: { userId: string; title: string; body: string; link: string; todayStart: Date }) {
  const existing = await prisma.notification.findFirst({
    where: {
      userId: input.userId,
      type: 'SYSTEM',
      title: input.title,
      link: input.link,
      createdAt: { gte: input.todayStart },
    },
    select: { id: true },
  });
  if (existing) return false;

  await prisma.notification.create({
    data: {
      userId: input.userId,
      type: 'SYSTEM',
      title: input.title,
      body: input.body,
      link: input.link,
    },
  });
  return true;
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}
