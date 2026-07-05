import { AUTOMATION_CORE_TEMPLATE_KEYS } from '@/lib/automation';
import { prisma } from '@/lib/prisma';

const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN'] as const;
const SALES_ROLES = ['SUPER_ADMIN', 'ADMIN', 'SALES'] as const;

type HealthIssue = {
  key: string;
  flowId?: string;
  flowName?: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  title: string;
  body: string;
  link: string;
};

export async function runAutomationHealthWatch({ limit = 20 }: { limit?: number } = {}) {
  const todayStart = startOfDay(new Date());
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const staleThreshold = new Date(Date.now() - 72 * 60 * 60 * 1000);
  const coldThreshold = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const flows = await prisma.automationFlow.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 300,
    include: { runs: { orderBy: { createdAt: 'desc' }, take: 50 } },
  });

  const issues: HealthIssue[] = [];
  const activeFlows = flows.filter((flow) => flow.status === 'ACTIVE');
  const enabledCoreKeys = new Set(activeFlows.map((flow) => flow.templateKey).filter(Boolean));
  const missingCoreKeys = AUTOMATION_CORE_TEMPLATE_KEYS.filter((key) => !enabledCoreKeys.has(key));

  if (flows.length === 0) {
    issues.push({
      key: 'NO_AUTOMATION_FLOWS',
      severity: 'CRITICAL',
      title: '自动化巡检: 尚未创建任何流程',
      body: '自动化中台没有流程。请先在自动化蓝图补齐台创建并开启核心流程,否则渠道线索仍然依赖人工发现。',
      link: '/automation',
    });
  } else if (activeFlows.length === 0) {
    issues.push({
      key: 'NO_ACTIVE_AUTOMATION_FLOWS',
      severity: 'CRITICAL',
      title: '自动化巡检: 没有启用流程',
      body: `当前共有 ${flows.length} 个流程,但没有任何流程处于开启状态。请至少启用线索分配、AI 草稿和未回复跟进流程。`,
      link: '/automation',
    });
  }

  if (missingCoreKeys.length > 0) {
    issues.push({
      key: `CORE_BLUEPRINT_GAP:${missingCoreKeys.sort().join(',')}`,
      severity: missingCoreKeys.length >= 4 ? 'CRITICAL' : 'WARNING',
      title: '自动化巡检: 核心蓝图未完全启用',
      body: `仍有 ${missingCoreKeys.length} 个核心自动化模板未启用。请补齐线索分配、线索评分、AI 回复、客户画像和多轮开发信流程。`,
      link: '/automation',
    });
  }

  for (const flow of flows) {
    const recentRuns = flow.runs || [];
    const failed24h = recentRuns.filter((run) => run.status === 'FAILED' && run.createdAt >= since24h);
    if (failed24h.length > 0) {
      issues.push({
        key: `FAILED_24H:${flow.id}:${failed24h.length}`,
        flowId: flow.id,
        flowName: flow.name,
        severity: 'CRITICAL',
        title: `自动化巡检: ${flow.name} 近 24 小时失败`,
        body: `流程「${flow.name}」近 24 小时有 ${failed24h.length} 次失败。请检查渠道授权、动作配置、AI 草稿或数据字段是否缺失。`,
        link: `/automation?flow=${flow.id}`,
      });
      continue;
    }

    const sampleRuns = recentRuns.slice(0, 20);
    if (sampleRuns.length >= 5) {
      const skipped = sampleRuns.filter((run) => run.status === 'SKIPPED').length;
      const skippedRate = skipped / sampleRuns.length;
      if (skippedRate >= 0.75) {
        issues.push({
          key: `HIGH_SKIPPED:${flow.id}:${Math.round(skippedRate * 100)}`,
          flowId: flow.id,
          flowName: flow.name,
          severity: 'WARNING',
          title: `自动化巡检: ${flow.name} 跳过率过高`,
          body: `流程「${flow.name}」最近 ${sampleRuns.length} 次运行中有 ${skipped} 次跳过。建议放宽关键词、意图、工作时间或渠道条件。`,
          link: `/automation?flow=${flow.id}`,
        });
      }
    }

    if (flow.status === 'ACTIVE' && flow.triggerCount === 0 && !flow.lastRunAt && flow.updatedAt <= staleThreshold) {
      issues.push({
        key: `ACTIVE_NEVER_RAN:${flow.id}`,
        flowId: flow.id,
        flowName: flow.name,
        severity: 'WARNING',
        title: `自动化巡检: ${flow.name} 开启后未触发`,
        body: `流程「${flow.name}」已开启超过 72 小时但从未运行。请检查触发渠道、模板条件和入口数据是否真正接入。`,
        link: `/automation?flow=${flow.id}`,
      });
    } else if (flow.status === 'ACTIVE' && flow.lastRunAt && flow.lastRunAt <= coldThreshold) {
      issues.push({
        key: `ACTIVE_COLD:${flow.id}`,
        flowId: flow.id,
        flowName: flow.name,
        severity: 'INFO',
        title: `自动化巡检: ${flow.name} 长时间未运行`,
        body: `流程「${flow.name}」已经超过 14 天没有运行。若这是核心流程,请确认线索入口和触发条件没有断开。`,
        link: `/automation?flow=${flow.id}`,
      });
    }
  }

  const rankedIssues = issues
    .sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity) || a.title.localeCompare(b.title))
    .slice(0, Math.max(1, Math.min(50, limit)));

  const recipients = await loadRecipients();
  let notified = 0;
  let duplicates = 0;

  for (const issue of rankedIssues) {
    const sentToday = await prisma.notification.count({
      where: {
        type: 'SYSTEM' as any,
        title: issue.title,
        link: issue.link,
        createdAt: { gte: todayStart },
      },
    });
    if (sentToday > 0) {
      duplicates++;
      continue;
    }
    if (!recipients.length) continue;
    await prisma.notification.createMany({
      data: recipients.map((user) => ({
        userId: user.id,
        type: 'SYSTEM' as any,
        title: issue.title,
        body: issue.body,
        link: issue.link,
      })),
    });
    notified += recipients.length;
  }

  return {
    flows: flows.length,
    activeFlows: activeFlows.length,
    issues: rankedIssues.length,
    critical: rankedIssues.filter((issue) => issue.severity === 'CRITICAL').length,
    warning: rankedIssues.filter((issue) => issue.severity === 'WARNING').length,
    info: rankedIssues.filter((issue) => issue.severity === 'INFO').length,
    notified,
    duplicates,
    recipients: recipients.length,
  };
}

async function loadRecipients() {
  const admins = await prisma.user.findMany({
    where: { role: { in: [...ADMIN_ROLES] as any }, isActive: true },
    select: { id: true },
  });
  if (admins.length) return admins;
  return prisma.user.findMany({
    where: { role: { in: [...SALES_ROLES] as any }, isActive: true },
    select: { id: true },
    take: 10,
  });
}

function severityWeight(severity: HealthIssue['severity']) {
  if (severity === 'CRITICAL') return 3;
  if (severity === 'WARNING') return 2;
  return 1;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
