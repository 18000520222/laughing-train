import { prisma } from '@/lib/prisma';
import { buildCustomerHealthRow } from '@/lib/customer-health';

type InboxWithCompany = Awaited<ReturnType<typeof loadInbox>>;
type Flow = NonNullable<Awaited<ReturnType<typeof loadFlow>>>;

const SALES_ROLES = ['SUPER_ADMIN', 'ADMIN', 'SALES'] as const;
const FAILED_REPLAY_SCAN_LIMIT = 200;
const automationCompanyInclude = {
  owner: true,
  contacts: { orderBy: { createdAt: 'asc' as const }, take: 3 },
  opportunities: { orderBy: { updatedAt: 'desc' as const }, take: 6 },
  followUps: { orderBy: { createdAt: 'desc' as const }, take: 3 },
  inboxMessages: { orderBy: { createdAt: 'desc' as const }, take: 6 },
  salesTasks: { where: { status: 'TODO' as const }, orderBy: [{ dueAt: 'asc' as const }, { createdAt: 'desc' as const }], take: 3 },
};

async function loadInbox(inboxId: string) {
  return prisma.inboxMessage.findUnique({
    where: { id: inboxId },
    include: {
      company: {
        include: automationCompanyInclude,
      },
    },
  });
}

async function loadFlow(flowId: string) {
  return prisma.automationFlow.findUnique({ where: { id: flowId } });
}

async function loadActiveFlows(channel: string) {
  return prisma.automationFlow.findMany({
    where: {
      status: 'ACTIVE',
      OR: [{ channel: 'ALL' }, { channel: channel as any }],
    },
    orderBy: { updatedAt: 'desc' },
  });
}

export async function runAutomationsForInbox(inboxId: string) {
  const inbox = await loadInbox(inboxId);
  if (!inbox || inbox.direction !== 'IN') return { evaluated: 0, matched: 0 };

  const flows = await loadActiveFlows(inbox.channel);
  let matchedCount = 0;

  for (const flow of flows) {
    const result = await runAutomationFlowForInbox(flow, inbox);
    if (result.matched) matchedCount++;
  }

  return { evaluated: flows.length, matched: matchedCount };
}

export async function replayAutomationRun(
  runId: string,
  { userId, source = 'manual_replay', skipIfAlreadyReplayed = false }: { userId?: string; source?: string; skipIfAlreadyReplayed?: boolean } = {}
) {
  const previous = await prisma.automationRun.findUnique({
    where: { id: runId },
    select: { id: true, flowId: true, inboxMessageId: true, status: true },
  });
  if (!previous) return { ok: false, reason: '运行记录不存在' };
  if (!previous.inboxMessageId) return { ok: false, reason: '该运行没有原始收件箱消息,不可重放' };

  if (skipIfAlreadyReplayed) {
    const existingReplay = await findExistingReplay(previous.id);
    if (existingReplay) {
      return {
        ok: false,
        reason: '该运行已重放',
        flowId: previous.flowId,
        replayOfRunId: previous.id,
        createdRunId: existingReplay.id,
      };
    }
  }

  const [flow, inbox] = await Promise.all([loadFlow(previous.flowId), loadInbox(previous.inboxMessageId)]);
  if (!flow) return { ok: false, reason: '流程不存在' };
  if (!inbox || inbox.direction !== 'IN') return { ok: false, reason: '原始消息不存在或不是入站消息' };
  if (flow.triggerType === 'NO_REPLY_TIMEOUT') return { ok: false, reason: '未回复超时流程由定时任务按轮次处理,不可手动重放' };

  const replay = await runAutomationFlowForInbox(flow, inbox, {
    ignoreExisting: true,
    source,
    replayOfRunId: previous.id,
    userId,
  });
  return {
    ok: true,
    flowId: flow.id,
    inboxId: inbox.id,
    replayOfRunId: previous.id,
    createdRunId: replay.createdRunId,
    matched: replay.matched,
    status: replay.status,
    skippedExisting: replay.skippedExisting,
  };
}

export async function listFailedAutomationReplayQueue({ limit = 10, flowId }: { limit?: number; flowId?: string } = {}) {
  const max = clampInt(limit, 1, 50);
  const runs = await prisma.automationRun.findMany({
    where: {
      status: 'FAILED' as any,
      ...(flowId ? { flowId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(FAILED_REPLAY_SCAN_LIMIT, Math.max(max * 5, max + 20)),
    include: { flow: { select: { id: true, name: true, flowCode: true, triggerType: true } } },
  });

  const items = [];
  const skippedReasons: Record<string, number> = {};
  let scanned = 0;

  for (const run of runs) {
    scanned++;
    const blocked = await replayBlockReason(run);
    if (blocked) {
      skippedReasons[blocked] = (skippedReasons[blocked] || 0) + 1;
      continue;
    }
    items.push({
      id: run.id,
      flowId: run.flowId,
      flowName: run.flow.name,
      flowCode: run.flow.flowCode,
      channel: run.channel,
      summary: run.summary,
      contactKey: run.contactKey,
      createdAt: run.createdAt,
    });
    if (items.length >= max) break;
  }

  return {
    scanned,
    replayableCount: items.length,
    skippedCount: Object.values(skippedReasons).reduce((sum, count) => sum + count, 0),
    skippedReasons,
    items,
  };
}

export async function bulkReplayFailedAutomationRuns({
  limit = 20,
  userId,
  flowId,
  dryRun = false,
}: {
  limit?: number;
  userId?: string;
  flowId?: string;
  dryRun?: boolean;
} = {}) {
  const max = clampInt(limit, 1, 50);
  const runs = await prisma.automationRun.findMany({
    where: {
      status: 'FAILED' as any,
      ...(flowId ? { flowId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(FAILED_REPLAY_SCAN_LIMIT, Math.max(max * 5, max + 20)),
    include: { flow: { select: { id: true, name: true, flowCode: true, triggerType: true } } },
  });

  const result = {
    ok: true,
    dryRun,
    limit: max,
    scanned: 0,
    replayable: 0,
    replayed: 0,
    skipped: 0,
    failed: 0,
    createdRunIds: [] as string[],
    results: [] as Array<{ runId: string; flowId: string; status: string; reason?: string; createdRunId?: string }>,
  };

  for (const run of runs) {
    if (result.replayable >= max) break;
    result.scanned++;

    const blocked = await replayBlockReason(run);
    if (blocked) {
      result.skipped++;
      result.results.push({ runId: run.id, flowId: run.flowId, status: 'SKIPPED', reason: blocked });
      continue;
    }

    result.replayable++;
    if (dryRun) {
      result.results.push({ runId: run.id, flowId: run.flowId, status: 'READY' });
      continue;
    }

    try {
      const replay = await replayAutomationRun(run.id, { userId, source: 'bulk_replay', skipIfAlreadyReplayed: true });
      if (replay.ok) {
        result.replayed++;
        if (replay.createdRunId) result.createdRunIds.push(replay.createdRunId);
        result.results.push({ runId: run.id, flowId: run.flowId, status: String(replay.status || 'REPLAYED'), createdRunId: replay.createdRunId });
      } else {
        result.skipped++;
        result.results.push({ runId: run.id, flowId: run.flowId, status: 'SKIPPED', reason: replay.reason });
      }
    } catch (error) {
      result.failed++;
      result.results.push({
        runId: run.id,
        flowId: run.flowId,
        status: 'FAILED',
        reason: error instanceof Error ? error.message : '批量重放失败',
      });
    }
  }

  return result;
}

async function replayBlockReason(run: { id: string; inboxMessageId: string | null; flow?: { triggerType: string } | null }) {
  if (!run.inboxMessageId) return '没有原始收件箱消息';
  if (!run.flow) return '流程不存在';
  if (run.flow.triggerType === 'NO_REPLY_TIMEOUT') return '超时未回复流程由定时任务处理';
  const existingReplay = await findExistingReplay(run.id);
  if (existingReplay) return '已重放';
  return null;
}

async function findExistingReplay(runId: string) {
  return prisma.automationRun.findFirst({
    where: {
      output: { path: ['replayOfRunId'], equals: runId } as any,
    },
    select: { id: true },
  });
}

async function runAutomationFlowForInbox(
  flow: Flow,
  inbox: NonNullable<InboxWithCompany>,
  options: { ignoreExisting?: boolean; source?: string; replayOfRunId?: string; userId?: string } = {}
) {
  if (!options.ignoreExisting) {
    const existingRun = await prisma.automationRun.findFirst({
      where: { flowId: flow.id, inboxMessageId: inbox.id },
      select: { id: true },
    });
    if (existingRun) return { matched: false, status: 'SKIPPED' as const, skippedExisting: true };
  }

  const trigger = await matchesTrigger(flow, inbox);
  const condition = trigger ? matchesCondition(flow, inbox) : { ok: false, reason: '触发器未命中' };
  const matched = trigger && condition.ok;
  const actionOutput = matched ? await executeInternalAction(flow, inbox) : { skippedReason: condition.reason };
  const runStatus = matched ? ('status' in actionOutput ? actionOutput.status : 'MATCHED') : 'SKIPPED';
  const output = {
    ...actionOutput,
    ...(options.replayOfRunId ? { replayOfRunId: options.replayOfRunId, replayedAt: new Date().toISOString() } : {}),
  };
  const run = await createAutomationRun(
    flow,
    inbox,
    matched,
    runStatus,
    matched ? `${options.replayOfRunId ? '重放命中' : '自动化命中'}: ${flow.name}` : `${options.replayOfRunId ? '重放跳过' : '自动化跳过'}: ${condition.reason}`,
    output,
    { userId: options.userId, source: options.source || 'inbox_ingest' }
  );
  await refreshFlowStats(flow.id);
  return { matched, status: runStatus, createdRunId: run.id, skippedExisting: false };
}

export async function runNoReplyTimeoutAutomations({ limit = 100 }: { limit?: number } = {}) {
  const flows = await prisma.automationFlow.findMany({
    where: { status: 'ACTIVE', triggerType: 'NO_REPLY_TIMEOUT' },
    orderBy: { updatedAt: 'desc' },
  });
  const result = {
    flows: flows.length,
    evaluated: 0,
    matched: 0,
    createdTasks: 0,
    skipped: 0,
  };

  for (const flow of flows) {
    const triggerConfig = jsonObject(flow.triggerConfig);
    const waitHours = Math.max(1, Math.min(720, Number(triggerConfig.waitHours || 48) || 48));
    const cutoff = new Date(Date.now() - waitHours * 60 * 60 * 1000);
    const inboxMessages = await prisma.inboxMessage.findMany({
      where: {
        direction: 'IN',
        status: { in: ['NEW', 'AI_DRAFTED'] as any },
        ...(flow.channel === 'ALL' ? {} : { channel: flow.channel as any }),
        OR: [{ sentAt: { lte: cutoff } }, { sentAt: null, createdAt: { lte: cutoff } }],
      },
      include: { company: { include: automationCompanyInclude } },
      orderBy: [{ sentAt: 'asc' }, { createdAt: 'asc' }],
      take: Math.max(1, Math.min(200, limit)),
    });

    for (const inbox of inboxMessages) {
      result.evaluated++;
      const condition = await matchesNoReplyCondition(flow, inbox, waitHours);
      if (!condition.ok) {
        if (!condition.silent) {
          await createAutomationRun(flow, inbox, false, 'SKIPPED', `自动化跳过: ${condition.reason}`, { skippedReason: condition.reason, waitHours });
          await refreshFlowStats(flow.id);
        }
        result.skipped++;
        continue;
      }

      const actionOutput = await executeNoReplyTimeoutAction(flow, inbox, waitHours, condition.round);
      const status = 'status' in actionOutput ? actionOutput.status : 'MATCHED';
      await createAutomationRun(flow, inbox, true, status, `自动化命中: ${flow.name}`, {
        ...actionOutput,
        waitHours,
        round: condition.round,
      });
      await refreshFlowStats(flow.id);
      result.matched++;
      if (actionOutput.createdTaskId) result.createdTasks++;
    }
  }

  return result;
}

async function matchesTrigger(flow: Flow, inbox: NonNullable<InboxWithCompany>) {
  if (flow.triggerType === 'CUSTOMER_MESSAGE') return true;
  if (flow.triggerType === 'NEW_LEAD' || flow.triggerType === 'NEW_VISITOR') {
    return (await isFirstMessageForContact(inbox)) || isNewCompany(inbox);
  }
  if (flow.triggerType === 'NO_REPLY_TIMEOUT') return false;
  return true;
}

async function matchesNoReplyCondition(flow: Flow, inbox: NonNullable<InboxWithCompany>, waitHours: number) {
  if (!inbox.companyId || !inbox.company) return { ok: false, reason: '未关联客户', round: 0, silent: true };
  if (inbox.status === 'REPLIED' || inbox.status === 'ARCHIVED') return { ok: false, reason: '消息已回复或归档', round: 0, silent: true };

  const after = inbox.sentAt || inbox.createdAt;
  const replied = await prisma.inboxMessage.findFirst({
    where: {
      id: { not: inbox.id },
      direction: 'OUT',
      createdAt: { gt: after },
      OR: [
        inbox.threadId ? { threadId: inbox.threadId } : undefined,
        inbox.companyId ? { companyId: inbox.companyId } : undefined,
        { channel: inbox.channel, senderId: inbox.senderId },
      ].filter(Boolean) as any,
    },
    select: { id: true },
  });
  if (replied) return { ok: false, reason: '已有后续回复', round: 0, silent: true };

  const config = jsonObject(flow.conditionConfig);
  const maxRounds = Math.max(1, Math.min(10, Number(config.maxRounds || 3) || 3));
  const previousRuns = await prisma.automationRun.findMany({
    where: {
      flowId: flow.id,
      inboxMessageId: inbox.id,
      matched: true,
    },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  if (previousRuns.length >= maxRounds) return { ok: false, reason: `已达到最大轮次 ${maxRounds}`, round: previousRuns.length, silent: true };
  const latestRun = previousRuns[0];
  if (latestRun) {
    const nextAt = new Date(latestRun.createdAt.getTime() + waitHours * 60 * 60 * 1000);
    if (nextAt.getTime() > Date.now()) return { ok: false, reason: '等待下一轮开发时间', round: previousRuns.length + 1, silent: true };
  }
  return { ok: true, round: previousRuns.length + 1, silent: false };
}

async function executeNoReplyTimeoutAction(flow: Flow, inbox: NonNullable<InboxWithCompany>, waitHours: number, round: number) {
  const owner = inbox.company?.owner || (await fallbackOwner());
  if (!owner || !inbox.companyId || !inbox.company) {
    await notifyUsers(flow, inbox, `客户超时未回复,但未找到负责人或客户档案。询盘:${inquiryCode(inbox)}`);
    return { status: 'SKIPPED' as const, skippedReason: '未找到负责人或客户档案' };
  }

  const sourceRef = `${flow.id}:${inbox.id}:round:${round}`;
  const existingTask = await prisma.salesTask.findFirst({
    where: { source: 'AUTOMATION_NO_REPLY_TIMEOUT', sourceRef, status: 'TODO' },
    select: { id: true },
  });
  if (existingTask) return { status: 'MATCHED' as const, skippedReason: '已有待办任务', createdTaskId: null };

  const dueAt = new Date();
  dueAt.setHours(dueAt.getHours() + (round === 1 ? 24 : 48));
  const draft = buildNoReplyDraft(flow, inbox, waitHours, round);
  const task = await prisma.salesTask.create({
    data: {
      title: `自动化开发信草稿: ${inbox.company.name} 第 ${round} 轮`,
      description: noReplyTaskDescription(flow, inbox, waitHours, round, draft.body),
      type: 'EMAIL',
      priority: round >= 3 ? 'HIGH' : 'NORMAL',
      dueAt,
      ownerId: owner.id,
      companyId: inbox.companyId,
      source: 'AUTOMATION_NO_REPLY_TIMEOUT',
      sourceRef,
      draftSubject: draft.subject,
      draftBody: draft.body,
      draftGeneratedAt: new Date(),
    },
  });

  await prisma.followUp.create({
    data: {
      companyId: inbox.companyId,
      userId: owner.id,
      type: 'AUTOMATION_DRIP',
      content: `自动化流程「${flow.name}」生成第 ${round} 轮开发信草稿。询盘:${inquiryCode(inbox)}`,
    },
  }).catch(() => null);

  await notifyUsers(flow, inbox, `客户 ${waitHours} 小时未回复,已生成第 ${round} 轮开发信草稿。询盘:${inquiryCode(inbox)}`);
  return { status: 'ACTION_SENT' as const, createdTaskId: task.id, draftSubject: draft.subject, round };
}

function matchesCondition(flow: Flow, inbox: NonNullable<InboxWithCompany>) {
  const type = flow.conditionType || 'NO_CONDITION';
  const config = jsonObject(flow.conditionConfig);
  const text = searchableText(inbox);

  if (type === 'NO_CONDITION') return { ok: true };
  if (type === 'KEYWORD_MATCH') {
    const keywords = stringArray((config.keywords || jsonObject(flow.triggerConfig).keywords) as unknown);
    const hit = keywords.some((keyword) => text.includes(keyword.toLowerCase()));
    return hit ? { ok: true } : { ok: false, reason: '未命中关键词' };
  }
  if (type === 'BUSINESS_HOURS') {
    return isInsideBusinessHours(config) ? { ok: true } : { ok: false, reason: '不在自动执行时段' };
  }
  if (type === 'OUTSIDE_BUSINESS_HOURS') {
    return isInsideBusinessHours(config) ? { ok: false, reason: '仍在营业时间' } : { ok: true };
  }
  if (type === 'LANGUAGE_NOT_ZH') {
    const lang = (inbox.detectedLang || '').toLowerCase();
    return lang && !['zh', 'zh-cn', 'zh-tw', 'cn', 'auto'].includes(lang) ? { ok: true } : { ok: false, reason: '客户语言为中文或未识别' };
  }
  if (type === 'INTENT_MATCH') {
    const intents = stringArray(config.intents);
    return inbox.intent && intents.includes(inbox.intent) ? { ok: true } : { ok: false, reason: '客户意图未匹配' };
  }
  if (type === 'LEAD_SCORE') {
    const minScore = Number(config.minScore || 80);
    const score = scoreLead(inbox);
    return score >= minScore ? { ok: true, score } : { ok: false, reason: `线索评分 ${score} 低于 ${minScore}`, score };
  }
  if (type === 'CUSTOMER_HEALTH') {
    return matchesCustomerHealthCondition(inbox, config);
  }
  if (type === 'ROUTE_RULE') return { ok: true };
  if (type === 'LEAD_NOT_REPLIED') return { ok: false, reason: '超时未回复流程由定时任务处理' };
  return { ok: true };
}

async function executeInternalAction(flow: Flow, inbox: NonNullable<InboxWithCompany>) {
  const actionConfig = jsonObject(flow.actionConfig);
  const actionType = flow.actionType;
  const owner = inbox.company?.owner || (await fallbackOwner());

  if (actionType === 'ASSIGN_OWNER') {
    const assignedUser = inbox.company?.owner || owner;
    if (inbox.companyId && assignedUser && !inbox.company?.ownerId) {
      await prisma.company.update({ where: { id: inbox.companyId }, data: { ownerId: assignedUser.id } });
    }
    if (inbox.companyId && assignedUser) {
      await prisma.followUp.create({
        data: {
          companyId: inbox.companyId,
          userId: assignedUser.id,
          type: 'AUTOMATION',
          content: `自动化流程「${flow.name}」分配/提醒跟进。询盘:${inquiryCode(inbox)}`,
        },
      }).catch(() => null);
    }
    await notifyUsers(flow, inbox, `已分配/提醒负责人:${assignedUser?.name || assignedUser?.email || '未分配'}`);
    return { status: 'ACTION_SENT' as const, assignedTo: assignedUser?.email || null };
  }

  if (actionType === 'ADD_TAG') {
    if (inbox.companyId && owner) {
      const tags = stringArray(actionConfig.tags).join(', ') || '待分配产品线';
      await prisma.followUp.create({
        data: {
          companyId: inbox.companyId,
          userId: owner.id,
          type: 'AUTOMATION_TAG',
          content: `自动化标签: ${tags}。来源:${flow.name}。询盘:${inquiryCode(inbox)}`,
        },
      }).catch(() => null);
    }
    return { status: 'ACTION_SENT' as const, tags: actionConfig.tags || [] };
  }

  if (actionType === 'CREATE_NOTIFICATION') {
    await notifyUsers(flow, inbox, `高价值线索提醒,请立即跟进。询盘:${inquiryCode(inbox)}`);
    return { status: 'ACTION_SENT' as const, priority: actionConfig.priority || 'normal' };
  }

  if (actionType === 'CREATE_HEALTH_REPAIR_TASK') {
    return executeCustomerHealthRepairAction(flow, inbox, actionConfig);
  }

  if (actionType === 'SEND_MESSAGE') {
    await notifyUsers(flow, inbox, `已生成自动消息草稿,等待人工确认。询盘:${inquiryCode(inbox)}`);
    return { status: 'MATCHED' as const, draft: actionConfig.message || null, requireHumanApproval: true };
  }

  if (actionType === 'AI_REPLY_DRAFT' || actionType === 'TRANSLATE_AND_DRAFT' || actionType === 'DRIP_EMAIL_DRAFT') {
    await notifyUsers(flow, inbox, `AI 草稿流程已命中,请在统一收件箱确认。询盘:${inquiryCode(inbox)}`);
    return { status: 'MATCHED' as const, draftReady: Boolean(inbox.aiReplyZh), requireHumanApproval: true };
  }

  await notifyUsers(flow, inbox, `自动化流程已命中。询盘:${inquiryCode(inbox)}`);
  return { status: 'MATCHED' as const, actionType };
}

async function executeCustomerHealthRepairAction(flow: Flow, inbox: NonNullable<InboxWithCompany>, actionConfig: Record<string, unknown>) {
  if (!inbox.companyId || !inbox.company) {
    await notifyUsers(flow, inbox, `客户健康修复流程命中,但消息未关联客户。询盘:${inquiryCode(inbox)}`);
    return { status: 'SKIPPED' as const, skippedReason: '未关联客户' };
  }

  const health = buildCustomerHealthRow(inbox.company);
  const owner = inbox.company.owner || (await fallbackOwner());
  if (!owner) {
    await notifyUsers(flow, inbox, `客户健康修复流程命中,但未找到可分配负责人。客户:${inbox.company.name}`);
    return { status: 'SKIPPED' as const, skippedReason: '未找到负责人', healthScore: health.score };
  }

  const sourceRef = `${flow.id}:${inbox.companyId}`;
  const existingTask = await prisma.salesTask.findFirst({
    where: { companyId: inbox.companyId, source: 'CUSTOMER_HEALTH_AUTOMATION', sourceRef, status: 'TODO' },
    select: { id: true },
  });
  if (existingTask) {
    return { status: 'MATCHED' as const, skippedReason: '已有客户健康自动化待办', healthScore: health.score, existingTaskId: existingTask.id };
  }

  const dueHours = Math.max(2, Math.min(168, Number(actionConfig.dueHours || dueHoursForHealth(health)) || dueHoursForHealth(health)));
  const dueAt = new Date();
  dueAt.setHours(dueAt.getHours() + dueHours);

  if (!inbox.company.ownerId) {
    await prisma.company.update({ where: { id: inbox.companyId }, data: { ownerId: owner.id } });
  }
  if (!String(inbox.company.nextAction || '').trim()) {
    await prisma.company.update({ where: { id: inbox.companyId }, data: { nextAction: health.action } });
  }

  const task = await prisma.salesTask.create({
    data: {
      title: `自动化修复客户健康短板: ${inbox.company.name}`,
      description: customerHealthAutomationDescription(flow, inbox, health),
      type: health.score < 55 || health.stalledOpportunityCount > 0 || health.overdueTaskCount > 0 ? 'RISK_RESCUE' : 'FOLLOW_UP',
      priority: health.score < 55 || !health.hasOwner || health.stalledOpportunityCount > 0 || health.overdueTaskCount > 0 ? 'URGENT' : health.score < 75 ? 'HIGH' : 'NORMAL',
      dueAt,
      ownerId: owner.id,
      companyId: inbox.companyId,
      source: 'CUSTOMER_HEALTH_AUTOMATION',
      sourceRef,
    },
  });

  await prisma.followUp.create({
    data: {
      companyId: inbox.companyId,
      userId: owner.id,
      type: 'AUTOMATION_HEALTH',
      content: `自动化流程「${flow.name}」生成客户健康修复任务。健康度 ${health.score},短板:${health.shortfalls.join('、') || '无明显短板'}。询盘:${inquiryCode(inbox)}`,
    },
  }).catch(() => null);
  await notifyUsers(flow, inbox, `客户健康度 ${health.score},已生成健康短板修复任务。短板:${health.shortfalls.join('、') || '无明显短板'}`);

  return { status: 'ACTION_SENT' as const, createdTaskId: task.id, healthScore: health.score, shortfalls: health.shortfalls };
}

async function notifyUsers(flow: Flow, inbox: NonNullable<InboxWithCompany>, body: string) {
  const users = inbox.company?.ownerId
    ? await prisma.user.findMany({ where: { id: inbox.company.ownerId, isActive: true }, select: { id: true } })
    : await prisma.user.findMany({ where: { role: { in: [...SALES_ROLES] as any }, isActive: true }, select: { id: true } });
  if (!users.length) return;

  await prisma.notification.createMany({
    data: users.map((user) => ({
      userId: user.id,
      type: 'SYSTEM' as any,
      title: `自动化命中: ${flow.name}`,
      body,
      link: `/automation?flow=${flow.id}`,
    })),
  });
}

async function refreshFlowStats(flowId: string) {
  const runs = await prisma.automationRun.findMany({
    where: { flowId },
    select: { matched: true, contactKey: true },
  });
  const total = runs.length;
  const matched = runs.filter((run) => run.matched);
  const uniqueContacts = new Set(matched.map((run) => run.contactKey).filter(Boolean)).size;

  await prisma.automationFlow.update({
    where: { id: flowId },
    data: {
      triggerCount: total,
      uniqueContactCount: uniqueContacts,
      participationRate: total ? Math.round((matched.length / total) * 10000) / 100 : 0,
      lastRunAt: new Date(),
    },
  });
}

async function createAutomationRun(
  flow: Flow,
  inbox: NonNullable<InboxWithCompany>,
  matched: boolean,
  status: 'MATCHED' | 'SKIPPED' | 'ACTION_SENT' | 'FAILED',
  summary: string,
  output: Record<string, unknown>,
  options: { userId?: string; source?: string } = {}
) {
  return prisma.automationRun.create({
    data: {
      flowId: flow.id,
      inboxMessageId: inbox.id,
      channel: inbox.channel as any,
      contactKey: inbox.companyId || inbox.threadId || inbox.senderId,
      status: status as any,
      matched,
      summary,
      input: {
        inboxId: inbox.id,
        triggerType: flow.triggerType,
        conditionType: flow.conditionType,
        senderId: inbox.senderId,
        companyId: inbox.companyId,
        intent: inbox.intent,
        detectedLang: inbox.detectedLang,
        source: options.source || 'automation_runner',
      },
      output: output as any,
      userId: options.userId,
    },
    select: { id: true },
  });
}

async function isFirstMessageForContact(inbox: NonNullable<InboxWithCompany>) {
  const where = inbox.companyId
    ? { companyId: inbox.companyId, direction: 'IN' as const }
    : { channel: inbox.channel, senderId: inbox.senderId, direction: 'IN' as const };
  const count = await prisma.inboxMessage.count({ where });
  return count <= 1;
}

function isNewCompany(inbox: NonNullable<InboxWithCompany>) {
  if (!inbox.company) return false;
  return Math.abs(inbox.createdAt.getTime() - inbox.company.createdAt.getTime()) < 5 * 60 * 1000;
}

function searchableText(inbox: NonNullable<InboxWithCompany>) {
  return [inbox.originalText, inbox.translatedText, inbox.intent, inbox.senderName, inbox.company?.name]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function scoreLead(inbox: NonNullable<InboxWithCompany>) {
  const text = searchableText(inbox);
  let score = 20;
  if (inbox.companyId) score += 15;
  if (inbox.senderId.includes('@') && !freeMailDomain(inbox.senderId)) score += 15;
  if (inbox.company?.country) score += 10;
  if (/(price|quotation|quote|rfq|invoice|purchase|sample|datasheet|rangefinder|laser|1535|905|测距|询价|报价)/i.test(text)) score += 25;
  if (inbox.intent === 'PRICE_INQUIRY' || inbox.intent === 'PRODUCT_QUESTION' || inbox.intent === 'SAMPLE_REQUEST') score += 20;
  return Math.min(score, 100);
}

function matchesCustomerHealthCondition(inbox: NonNullable<InboxWithCompany>, config: Record<string, unknown>) {
  if (!inbox.company) return { ok: false, reason: '未关联客户' };

  const health = buildCustomerHealthRow(inbox.company);
  const maxScore = Number(config.maxScore || 55);
  const minScore = Number(config.minScore || 0);
  const shortfallsAny = stringArray(config.shortfallsAny);
  const hitShortfall = shortfallsAny.length > 0 && shortfallsAny.some((item) => health.shortfalls.includes(item));
  const hitLowScore = health.score <= maxScore && health.score >= minScore;
  const hitStalled = Boolean(config.includeStalled) && health.stalledOpportunityCount > 0;
  const hitOverdue = Boolean(config.includeOverdue) && health.overdueTaskCount > 0;
  const hitUnassigned = Boolean(config.includeUnassigned) && !health.hasOwner;

  if (hitLowScore || hitShortfall || hitStalled || hitOverdue || hitUnassigned) {
    return {
      ok: true,
      score: health.score,
      shortfalls: health.shortfalls,
      matchedBy: {
        lowScore: hitLowScore,
        shortfall: hitShortfall,
        stalled: hitStalled,
        overdue: hitOverdue,
        unassigned: hitUnassigned,
      },
    };
  }
  return { ok: false, reason: `客户健康度 ${health.score},无命中短板`, score: health.score, shortfalls: health.shortfalls };
}

function dueHoursForHealth(health: ReturnType<typeof buildCustomerHealthRow>) {
  if (health.score < 55 || health.stalledOpportunityCount > 0 || health.overdueTaskCount > 0 || !health.hasOwner) return 24;
  if (health.score < 75) return 48;
  return 72;
}

function customerHealthAutomationDescription(flow: Flow, inbox: NonNullable<InboxWithCompany>, health: ReturnType<typeof buildCustomerHealthRow>) {
  return [
    `流程: ${flow.name}`,
    `客户: ${inbox.company?.name || '-'}`,
    `渠道: ${inbox.channel}`,
    `询盘: ${inquiryCode(inbox)}`,
    `客户健康度: ${health.score}`,
    `五点短板: ${health.shortfalls.join('、') || '无明显短板'}`,
    `五维得分: 资料${health.fitScore}/20, 联系人${health.contactScore}/20, 互动${health.engagementScore}/20, 商机${health.pipelineScore}/20, 下一步${health.ownerScore}/20`,
    `互动间隔: ${health.daysSinceLastInteraction >= 999 ? '-' : health.daysSinceLastInteraction} 天`,
    `进行中商机: ${health.openOpportunityCount}, 停滞商机: ${health.stalledOpportunityCount}, 逾期任务: ${health.overdueTaskCount}`,
    `建议动作: ${health.action}`,
    '',
    `客户原文: ${String(inbox.translatedText || inbox.originalText || '').slice(0, 500)}`,
  ].join('\n');
}

function freeMailDomain(senderId: string) {
  const domain = senderId.split('@')[1]?.toLowerCase() || '';
  return ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'qq.com', '163.com', '126.com'].includes(domain);
}

function isInsideBusinessHours(config: Record<string, unknown>) {
  const timezone = String(config.timezone || 'Asia/Shanghai');
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === 'weekday')?.value || 'Mon';
  const hour = parts.find((part) => part.type === 'hour')?.value || '00';
  const minute = parts.find((part) => part.type === 'minute')?.value || '00';
  const current = `${hour}:${minute}`;
  const weekdays = stringArray(config.weekdays);
  const start = String(config.start || '09:00');
  const end = String(config.end || '20:00');
  if (weekdays.length && !weekdays.includes(weekday)) return false;
  return current >= start && current <= end;
}

async function fallbackOwner() {
  return prisma.user.findFirst({
    where: { role: { in: [...SALES_ROLES] as any }, isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true, name: true },
  });
}

function inquiryCode(inbox: NonNullable<InboxWithCompany>) {
  return `INQ-${inbox.createdAt.getFullYear()}-${inbox.id.slice(-6).toUpperCase()}`;
}

function buildNoReplyDraft(flow: Flow, inbox: NonNullable<InboxWithCompany>, waitHours: number, round: number) {
  const companyName = inbox.company?.name || inbox.senderName || 'there';
  const productHint = productHintFromText(searchableText(inbox));
  const subject = round === 1 ? `Follow-up on your ERDI ${productHint} inquiry` : `Checking in on ERDI ${productHint} details`;
  const body = [
    `Hi ${companyName},`,
    '',
    `I wanted to follow up on your previous message about ${productHint}. We have not heard back for about ${waitHours} hours, so I am sending the key points again for your review.`,
    '',
    'To recommend the right ERDI solution, could you confirm:',
    '1. Target range and working environment',
    '2. Required wavelength / eye-safety requirement',
    '3. Quantity plan and expected delivery time',
    '4. Any size, weight, interface, or certification constraints',
    '',
    'Once we have these details, our sales engineer can prepare the suitable option, datasheet, and quotation.',
    '',
    'Best regards,',
    'ERDI TECH LTD',
    '',
    `Automation note: generated by "${flow.name}" round ${round}. Please review before sending.`,
  ].join('\n');
  return { subject, body };
}

function noReplyTaskDescription(flow: Flow, inbox: NonNullable<InboxWithCompany>, waitHours: number, round: number, draftBody: string) {
  return [
    `流程: ${flow.name}`,
    `客户: ${inbox.company?.name || '-'}`,
    `渠道: ${inbox.channel}`,
    `询盘: ${inquiryCode(inbox)}`,
    `等待: ${waitHours} 小时`,
    `轮次: ${round}`,
    `客户原文: ${String(inbox.translatedText || inbox.originalText || '').slice(0, 500)}`,
    '',
    '开发信草稿:',
    draftBody,
  ].join('\n');
}

function productHintFromText(text: string) {
  if (/1535/.test(text)) return '1535nm laser rangefinder';
  if (/905/.test(text)) return '905nm laser rangefinder';
  if (/designator|指示/.test(text)) return 'laser target designator';
  if (/rangefinder|测距/.test(text)) return 'laser rangefinder';
  if (/module|模块/.test(text)) return 'laser module';
  return 'laser rangefinder';
}

function jsonObject(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

function clampInt(value: number, min: number, max: number) {
  const parsed = Number.isFinite(value) ? Math.floor(value) : min;
  return Math.max(min, Math.min(max, parsed));
}
