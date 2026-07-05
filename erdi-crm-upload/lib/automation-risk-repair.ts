import { assessAutomationFlowRisk, type FlowForInsights } from '@/lib/automation-insights';
import { bulkReplayFailedAutomationRuns } from '@/lib/automation-runner';
import { prisma } from '@/lib/prisma';

const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN'] as const;

export async function repairAutomationRiskFlow({ flowId, userId }: { flowId: string; userId?: string }) {
  const flow = await prisma.automationFlow.findUnique({
    where: { id: flowId },
    include: { runs: { orderBy: { createdAt: 'desc' }, take: 20 } },
  });
  if (!flow) return { ok: false, status: 'missing', flowId, action: 'MISSING', updated: 0, createdRun: 0, replayed: 0, notified: 0, skipped: 1 };

  const risk = assessAutomationFlowRisk(flow as FlowForInsights);
  if (!risk) {
    const notified = await notifyAdmins({
      title: '自动化风险修复: 当前流程状态稳定',
      body: `${flow.name}: 暂未发现需要自动修复的风险。`,
      link: `/automation?flow=${flow.id}`,
    });
    return { ok: true, status: 'stable', flowId, action: 'REVIEW', updated: 0, createdRun: 0, replayed: 0, notified, skipped: 0 };
  }

  if (risk.repairAction === 'ACTIVATE') {
    await prisma.automationFlow.update({ where: { id: flow.id }, data: { status: 'ACTIVE' } });
    const notified = await notifyAdmins({
      title: '自动化风险修复: 流程已开启',
      body: `${flow.name}: 已从 ${flow.status} 切换为 ACTIVE。建议立即运行测试,确认触发器、条件和动作配置。`,
      link: `/automation?flow=${flow.id}`,
    });
    return { ok: true, status: 'activated', flowId, action: risk.repairAction, updated: 1, createdRun: 0, replayed: 0, notified, skipped: 0 };
  }

  if (risk.repairAction === 'TEST') {
    await createRiskRepairTestRun(flow, userId);
    const notified = await notifyAdmins({
      title: '自动化风险修复: 已生成测试运行',
      body: `${flow.name}: 因“${risk.reason}”已生成测试运行。请检查最近运行输出,确认入口和条件是否继续需要调整。`,
      link: `/automation?flow=${flow.id}`,
    });
    return { ok: true, status: 'tested', flowId, action: risk.repairAction, updated: 1, createdRun: 1, replayed: 0, notified, skipped: 0 };
  }

  if (risk.repairAction === 'REPLAY') {
    const replay = await bulkReplayFailedAutomationRuns({ flowId: flow.id, userId, limit: 10 });
    const notified = await notifyAdmins({
      title: '自动化风险修复: 失败运行已处理',
      body: `${flow.name}: 已扫描 ${replay.scanned} 条失败运行,重放 ${replay.replayed} 条,跳过 ${replay.skipped} 条,异常 ${replay.failed} 条。`,
      link: `/automation?flow=${flow.id}`,
    });
    return {
      ok: true,
      status: 'replayed',
      flowId,
      action: risk.repairAction,
      updated: 0,
      createdRun: replay.createdRunIds.length,
      replayed: replay.replayed,
      notified,
      skipped: replay.skipped + replay.failed,
    };
  }

  if (risk.repairAction === 'TUNE_CONDITION') {
    await writeRiskRepairNote(flow, risk);
    const notified = await notifyAdmins({
      title: '自动化风险修复: 已写入调参建议',
      body: `${flow.name}: ${risk.reason}。已在条件备注写入修复建议,请复核关键词、意图、语言、时段或渠道条件。`,
      link: `/automation?flow=${flow.id}`,
    });
    return { ok: true, status: 'tuned', flowId, action: risk.repairAction, updated: 1, createdRun: 0, replayed: 0, notified, skipped: 0 };
  }

  const notified = await notifyAdmins({
    title: '自动化风险修复: 已提醒复核',
    body: `${flow.name}: ${risk.reason}。请进入自动化中台查看流程配置和最近运行。`,
    link: `/automation?flow=${flow.id}`,
  });
  return { ok: true, status: 'notified', flowId, action: risk.repairAction, updated: 0, createdRun: 0, replayed: 0, notified, skipped: 0 };
}

async function createRiskRepairTestRun(flow: FlowForInsights, userId?: string) {
  const output = {
    trigger: flow.triggerType,
    condition: flow.conditionType || 'NO_CONDITION',
    action: flow.actionType,
    preview: '自动化风险修复生成的测试运行',
  };
  await prisma.$transaction([
    prisma.automationRun.create({
      data: {
        flowId: flow.id,
        channel: flow.channel as any,
        contactKey: 'risk-repair-test',
        status: flow.actionType === 'SEND_MESSAGE' ? 'ACTION_SENT' : 'MATCHED',
        matched: true,
        summary: `风险修复测试: ${flow.name}`,
        input: { source: 'automation_risk_repair', sampleText: 'Hello, I need laser rangefinder details.' },
        output,
        userId,
      },
    }),
    prisma.automationFlow.update({
      where: { id: flow.id },
      data: {
        triggerCount: { increment: 1 },
        uniqueContactCount: { increment: 1 },
        participationRate: 100,
        lastRunAt: new Date(),
      },
    }),
  ]);
}

async function writeRiskRepairNote(flow: FlowForInsights, risk: NonNullable<ReturnType<typeof assessAutomationFlowRisk>>) {
  const current = (flow.conditionConfig || {}) as Record<string, unknown>;
  const existing = String(current.operatorNote || '').trim();
  const stamp = new Date().toISOString().slice(0, 10);
  const nextNote = `[${stamp}] 自动化体检: ${risk.reason}; ${risk.repairHint}`;
  await prisma.automationFlow.update({
    where: { id: flow.id },
    data: {
      conditionConfig: {
        ...current,
        operatorNote: existing ? `${existing}\n${nextNote}` : nextNote,
      },
    },
  });
}

async function notifyAdmins({ title, body, link }: { title: string; body: string; link: string }) {
  const admins = await prisma.user.findMany({
    where: { role: { in: [...ADMIN_ROLES] as any }, isActive: true },
    select: { id: true },
  });
  if (admins.length === 0) return 0;
  await prisma.notification.createMany({
    data: admins.map((admin) => ({
      userId: admin.id,
      type: 'SYSTEM' as any,
      title,
      body,
      link,
    })),
  });
  return admins.length;
}
