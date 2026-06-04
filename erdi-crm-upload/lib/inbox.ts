// lib/inbox.ts — 统一收件箱 ingest pipeline(全渠道复用的核心流水线)
//
// 任何渠道的标准化入站消息 → 这里统一处理:
//   1. 去重(externalId)
//   2. 翻译为中文
//   3. AI 生成回复草稿(按全局 autoReplyMode 决定是否生成/自动发)
//   4. 关联已知客户公司
//   5. 入库 InboxMessage
//   6. 通知业务员
//
// 渠道适配器只负责"解析原始 payload → NormalizedMessage"和"send",
// 业务逻辑全部集中在此,新增渠道零重复。

import { prisma } from '@/lib/prisma';
import { translateText } from '@/lib/translate';
import { generateAutoReply } from '@/lib/autoreply';
import type { NormalizedMessage, ChannelType } from '@/lib/channels/types';

export interface IngestResult {
  created: boolean;
  inboxId?: string;
  autoSent?: boolean;
  skippedReason?: string;
}

/**
 * 处理一条标准化入站消息。幂等:相同 (channel, externalId) 不重复入库。
 */
export async function ingestInbound(msg: NormalizedMessage): Promise<IngestResult> {
  // 1. 去重
  if (msg.externalId) {
    const exists = await prisma.inboxMessage.findFirst({
      where: { channel: msg.channel as any, externalId: msg.externalId },
      select: { id: true },
    });
    if (exists) return { created: false, skippedReason: 'duplicate' };
  }

  const settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
  const autoReplyMode = (settings?.autoReplyMode || 'DRAFT').toUpperCase(); // OFF/DRAFT/AUTO
  const businessInfo = settings?.aiBusinessInfo || undefined;

  // 2. 翻译为中文
  const { translatedText, detectedLanguage } = await translateText(msg.text, 'zh', 'auto');

  // 3. 关联已知客户(按发送方标识尾号匹配联系人电话)
  const company = await matchCompany(msg);

  // 4. AI 回复(OFF 模式跳过)
  let intent: string | undefined;
  let aiReplyZh: string | undefined;
  let aiReplyCustomer: string | undefined;
  let aiAutoSendable = false;
  let detected = detectedLanguage;

  if (autoReplyMode !== 'OFF') {
    const history = await loadHistory(msg);
    const ai = await generateAutoReply({
      message: msg.text,
      history,
      businessInfo,
      contactInfo: company ? `公司:${company.name}${company.country ? ' / 国家:' + company.country : ''}` : undefined,
    });
    if (ai.available) {
      intent = ai.intent;
      aiReplyZh = ai.replyZh;
      aiReplyCustomer = ai.replyCustomer;
      aiAutoSendable = ai.shouldAutoSend;
      if (!detected || detected === 'auto') detected = ai.detectedLang;
    }
  }

  // 5. 入库
  const status = aiReplyZh ? 'AI_DRAFTED' : 'NEW';
  const saved = await prisma.inboxMessage.create({
    data: {
      channel: msg.channel as any,
      direction: 'IN',
      externalId: msg.externalId,
      threadId: msg.threadId,
      senderId: msg.senderId,
      senderName: msg.senderName,
      originalText: msg.text,
      detectedLang: detected,
      translatedText,
      intent,
      aiReplyZh,
      aiReplyCustomer,
      aiAutoSendable,
      status: status as any,
      mediaUrl: msg.mediaUrl,
      companyId: company?.id,
      sentAt: msg.sentAt,
    },
  });

  // 6. AUTO 模式 + AI 判定可自动发 → 由调用方负责实际发送(pipeline 不直接持有 adapter)
  const autoSent = autoReplyMode === 'AUTO' && aiAutoSendable && !!aiReplyCustomer;

  // 7. 通知业务员
  await notify(msg, translatedText, saved.id);

  return { created: true, inboxId: saved.id, autoSent };
}

/** 根据发送方标识匹配已有客户公司(电话尾 8 位) */
async function matchCompany(msg: NormalizedMessage) {
  const digits = msg.senderId.replace(/[^\d]/g, '');
  if (digits.length >= 6) {
    const contact = await prisma.contact.findFirst({
      where: { phone: { contains: digits.slice(-8) } },
      include: { company: true },
    });
    if (contact?.company) return contact.company;
  }
  return null;
}

/** 取该会话最近历史(给 AI 上下文) */
async function loadHistory(msg: NormalizedMessage): Promise<string[]> {
  const key = msg.threadId
    ? { channel: msg.channel as any, threadId: msg.threadId }
    : { channel: msg.channel as any, senderId: msg.senderId };
  const rows = await prisma.inboxMessage.findMany({
    where: key,
    orderBy: { createdAt: 'desc' },
    take: 8,
  });
  return rows
    .reverse()
    .map((r) =>
      r.direction === 'IN'
        ? `客户: ${r.originalText}`
        : `我方: ${r.aiReplyCustomer || r.originalText}`
    );
}

async function notify(msg: NormalizedMessage, preview: string, link: string) {
  try {
    const admins = await prisma.user.findMany({
      where: { role: { in: ['SUPER_ADMIN', 'ADMIN', 'SALES'] }, isActive: true },
      select: { id: true },
    });
    if (!admins.length) return;
    await prisma.notification.createMany({
      data: admins.map((u) => ({
        userId: u.id,
        type: 'WHATSAPP' as const, // 复用现有枚举;统一收件箱链接到 /inbox
        title: `${channelLabel(msg.channel)}: ${msg.senderName || msg.senderId}`,
        body: preview.slice(0, 100),
        link: '/inbox',
      })),
    });
  } catch (err) {
    console.error('[inbox] notify failed:', err);
  }
}

function channelLabel(c: ChannelType): string {
  return (
    { WHATSAPP: 'WhatsApp', ALIBABA: '阿里国际站', AMAZON: '亚马逊', SHOPEE: '虾皮', FACEBOOK: 'Facebook' } as Record<
      ChannelType,
      string
    >
  )[c];
}

/**
 * 标记一条消息为已回复(人工或自动发送成功后调用)。
 */
export async function markReplied(inboxId: string, sentCustomerText: string, sentZh?: string) {
  await prisma.inboxMessage.update({
    where: { id: inboxId },
    data: {
      status: 'REPLIED' as any,
      aiReplyCustomer: sentCustomerText,
      ...(sentZh ? { aiReplyZh: sentZh } : {}),
    },
  });
}
