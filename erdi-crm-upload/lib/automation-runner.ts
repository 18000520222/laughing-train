import { prisma } from '@/lib/prisma';

type InboxWithCompany = Awaited<ReturnType<typeof loadInbox>>;
type Flow = NonNullable<Awaited<ReturnType<typeof loadActiveFlows>>>[number];

const SALES_ROLES = ['SUPER_ADMIN', 'ADMIN', 'SALES'] as const;

async function loadInbox(inboxId: string) {
  return prisma.inboxMessage.findUnique({
    where: { id: inboxId },
    include: { company: { include: { owner: true } } },
  });
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
    const existingRun = await prisma.automationRun.findFirst({
      where: { flowId: flow.id, inboxMessageId: inbox.id },
      select: { id: true },
    });
    if (existingRun) continue;

    const trigger = await matchesTrigger(flow, inbox);
    const condition = trigger ? matchesCondition(flow, inbox) : { ok: false, reason: '触发器未命中' };
    const matched = trigger && condition.ok;
    if (matched) matchedCount++;

    const actionOutput = matched ? await executeInternalAction(flow, inbox) : { skippedReason: condition.reason };
    const runStatus = matched ? ('status' in actionOutput ? actionOutput.status : 'MATCHED') : 'SKIPPED';
    await prisma.automationRun.create({
      data: {
        flowId: flow.id,
        inboxMessageId: inbox.id,
        channel: inbox.channel as any,
        contactKey: inbox.companyId || inbox.threadId || inbox.senderId,
        status: runStatus,
        matched,
        summary: matched ? `自动化命中: ${flow.name}` : `自动化跳过: ${condition.reason}`,
        input: {
          inboxId: inbox.id,
          triggerType: flow.triggerType,
          conditionType: flow.conditionType,
          senderId: inbox.senderId,
          companyId: inbox.companyId,
          intent: inbox.intent,
          detectedLang: inbox.detectedLang,
        },
        output: actionOutput,
      },
    });

    await refreshFlowStats(flow.id);
  }

  return { evaluated: flows.length, matched: matchedCount };
}

async function matchesTrigger(flow: Flow, inbox: NonNullable<InboxWithCompany>) {
  if (flow.triggerType === 'CUSTOMER_MESSAGE') return true;
  if (flow.triggerType === 'NEW_LEAD' || flow.triggerType === 'NEW_VISITOR') {
    return (await isFirstMessageForContact(inbox)) || isNewCompany(inbox);
  }
  if (flow.triggerType === 'NO_REPLY_TIMEOUT') return false;
  return true;
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

function jsonObject(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}
