// lib/inbox.ts — 统一收件箱 ingest pipeline(全渠道复用的核心流水线)
//
// 任何渠道的标准化入站消息 → 这里统一处理:
//   1. 去重(externalId)
//   2. 翻译为中文
//   3. AI 生成回复草稿(按全局 autoReplyMode 决定是否生成/自动发)
//   4. 关联已知客户公司
//   5. 入库 InboxMessage
//   6. 执行已开启的自动化流程(只做内部记录/通知/分配,不直接外发)
//   7. 通知业务员
//
// 渠道适配器只负责"解析原始 payload → NormalizedMessage"和"send",
// 业务逻辑全部集中在此,新增渠道零重复。

import { prisma } from '@/lib/prisma';
import { translateText } from '@/lib/translate';
import { generateAutoReply } from '@/lib/autoreply';
import { runAutomationsForInbox } from '@/lib/automation-runner';
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

  // 3. 关联已知客户(邮件按 email 匹配/自动建客户；其他渠道按电话尾号匹配)
  const company = await matchOrCreateCompany(msg);

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

  // 7. 自动化流程执行。失败不阻断入库,避免渠道消息丢失。
  await runAutomationsForInbox(saved.id).catch((err) => {
    console.error('[inbox] automation runner failed:', err);
  });

  // 8. 通知业务员
  await notify(msg, translatedText, saved.id);

  return { created: true, inboxId: saved.id, autoSent };
}

/**
 * 关联客户公司。
 * - 邮件渠道(senderId 为 email):先按 Contact.email 精确匹配;匹配不到则自动建客户
 *   (按域名归并/复用 Company,新建 Contact),实现"新邮件自动建客户"。
 * - 其他渠道:按电话尾 8 位匹配已有联系人。
 */
async function matchOrCreateCompany(msg: NormalizedMessage) {
  // 邮件渠道:email 匹配 + 自动建客户
  if (msg.channel === 'EMAIL' && msg.senderId.includes('@')) {
    const email = msg.senderId.toLowerCase().trim();

    const contact = await prisma.contact.findUnique({
      where: { email },
      include: { company: true },
    });
    if (contact?.company) return contact.company;

    // 自动建客户:按域名复用/新建 Company,再建 Contact
    const domain = email.split('@')[1] || 'unknown';
    const { firstName, lastName } = splitName(msg.senderName, email);
    const companyName = guessCompanyName(domain, msg.senderName);

    let company = await prisma.company.findFirst({ where: { name: companyName } });
    if (!company) {
      const admin = await prisma.user.findFirst({
        where: { role: 'SUPER_ADMIN', isActive: true },
        select: { id: true },
      });
      company = await prisma.company.create({
        data: {
          name: companyName,
          source: 'EMAIL',
          type: 'INQUIRY',
          isPublic: false,
          ownerId: admin?.id ?? undefined,
        },
      });
    }

    // Contact 可能已存在但无 company,补建/补关联
    if (contact && !contact.companyId) {
      await prisma.contact.update({ where: { id: contact.id }, data: { companyId: company.id } });
    } else if (!contact) {
      await prisma.contact.create({
        data: { firstName, lastName: lastName ?? undefined, email, companyId: company.id },
      });
    }
    return company;
  }

  // 其他渠道(阿里/亚马逊/虾皮/Facebook/WhatsApp/LinkedIn):先电话尾号匹配
  const digits = msg.senderId.replace(/[^\d]/g, '');
  if (digits.length >= 6) {
    const contact = await prisma.contact.findFirst({
      where: { phone: { contains: digits.slice(-8) } },
      include: { company: true },
    });
    if (contact?.company) return contact.company;
  }

  // 再按外部账号ID匹配已有联系人(避免重复建档)
  const existing = await prisma.contact.findFirst({
    where: { externalId: msg.senderId },
    include: { company: true },
  }).catch(() => null);
  if (existing?.company) return existing.company;

  // 匹配不到 → 自动建潜在客户(成熟CRM:任何渠道新联系人都自动入库)
  const displayName = (msg.senderName || '').trim() || ('客户-' + msg.senderId.slice(-6));
  const channelSource = channelLabel(msg.channel);
  const admin = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN', isActive: true },
    select: { id: true },
  });
  const company = await prisma.company.create({
    data: {
      name: displayName,
      source: channelSource,
      type: 'INQUIRY',
      isPublic: false,
      ownerId: admin?.id ?? undefined,
    },
  });
  // 建联系人,记录外部账号ID + 电话(若有)
  const { firstName, lastName } = splitName(msg.senderName, msg.senderId);
  await prisma.contact.create({
    data: {
      firstName,
      lastName: lastName ?? undefined,
      phone: digits.length >= 6 ? digits : undefined,
      externalId: msg.senderId,
      companyId: company.id,
    },
  }).catch(() => {});
  return company;
}

/** 从显示名或邮箱本地段拆出 first/last name */
function splitName(displayName: string | undefined, email: string): { firstName: string; lastName: string | null } {
  const dn = (displayName || '').trim();
  if (dn && !dn.includes('@')) {
    const parts = dn.split(/\s+/);
    if (parts.length >= 2) return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
    return { firstName: dn, lastName: null };
  }
  return { firstName: email.split('@')[0], lastName: null };
}

/** 公司名:个人邮箱用显示名兜底,企业邮箱用域名首段 */
function guessCompanyName(domain: string, displayName?: string): string {
  const freeMail = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'qq.com', '163.com', '126.com', 'icloud.com', 'mail.ru', 'gmx.com', 'aol.com', 'protonmail.com'];
  if (freeMail.includes(domain.toLowerCase())) {
    const dn = (displayName || '').trim();
    return dn && !dn.includes('@') ? dn : domain;
  }
  const first = domain.split('.')[0];
  return first.charAt(0).toUpperCase() + first.slice(1);
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
        type: notificationType(msg.channel) as any,
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
    { WHATSAPP: 'WhatsApp', ALIBABA: '阿里国际站', AMAZON: '亚马逊', SHOPEE: '虾皮', FACEBOOK: 'Facebook', LINKEDIN: 'LinkedIn', EMAIL: '邮件', SALESMARTLY: 'SaleSmartly' } as Record<
      ChannelType,
      string
    >
  )[c];
}

function notificationType(c: ChannelType): string {
  if (c === 'FACEBOOK' || c === 'LINKEDIN' || c === 'SALESMARTLY') return 'SOCIAL';
  if (c === 'EMAIL') return 'EMAIL';
  if (c === 'AMAZON' || c === 'ALIBABA' || c === 'SHOPEE') return 'SYSTEM';
  return 'WHATSAPP';
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
