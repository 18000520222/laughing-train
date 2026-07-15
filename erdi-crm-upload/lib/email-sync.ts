import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { EmailAccount } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { buildEmailImapAuth } from '@/lib/google-gmail-oauth';
import { classifyEmail, type EmailClassification } from '@/lib/email-classifier';
import { ingestInbound } from '@/lib/inbox';
import type { NormalizedMessage } from '@/lib/channels/types';
import { extractEmailAddress, stripQuotedHistory } from '@/lib/email-content';
import { processEmailSalesAutomation } from '@/lib/email-sales-automation';

const OWN_DOMAINS = ['erdicn.com', 'erdimail.com', 'erditechs.com', 'erdicrm.com'];
const NOISE_CATEGORIES = new Set(['SEO_SPAM', 'MARKETING_NEWSLETTER', 'PLATFORM_ALERT', 'INTERNAL']);
const BUSINESS_CATEGORIES = new Set(['INQUIRY', 'QUOTE_PI', 'ORDER_PO', 'PAYMENT_FINANCE', 'TECH_SUPPORT', 'CUSTOMS_COMPLIANCE', 'MEETING_FOLLOWUP']);
const PLATFORM_DOMAINS = ['myshopline.com', 'made-in-china.com', 'alibaba.com'];

export interface EmailSyncOptions {
  lookback?: number;
  maxFetchPerAccount?: number;
  historyBatch?: number;
  backlogLimit?: number;
  enrich?: boolean;
  automations?: boolean;
  notifications?: boolean;
}

interface FolderReport {
  mailbox: string;
  direction: 'IN' | 'OUT';
  fetched: number;
  inserted: number;
  updated: number;
  ignored: number;
  historyFetched: number;
  cursorBefore: string | null;
  cursorAfter: string | null;
  errors: string[];
}

export interface EmailSyncAccountReport {
  account: string;
  connected: boolean;
  folders: FolderReport[];
  errors: string[];
}

export async function syncAllEmailAccounts(options: EmailSyncOptions = {}) {
  const accounts = await prisma.emailAccount.findMany({ where: { isActive: true }, orderBy: { createdAt: 'asc' } });
  const reports: EmailSyncAccountReport[] = [];
  for (const account of accounts) reports.push(await syncEmailAccount(account, options));

  const backlog = await processEmailBacklog({
    limit: options.backlogLimit || 50,
    enrich: options.enrich === true,
    automations: options.automations === true,
    notifications: options.notifications !== false,
  });
  return { accounts: reports, backlog };
}

export async function testEmailAccountConnection(accountId: string) {
  const account = await prisma.emailAccount.findUnique({ where: { id: accountId } });
  if (!account) return { ok: false, error: 'account-not-found' };
  let client: ImapFlow | null = null;
  const startedAt = Date.now();
  try {
    client = await createImapClient(account);
    await client.connect();
    const mailboxes = await client.list();
    const sent = findSentMailbox(mailboxes);
    await client.logout();
    return { ok: true, latencyMs: Date.now() - startedAt, inbox: true, sentMailbox: sent, mailboxCount: mailboxes.length };
  } catch (error) {
    client?.close();
    return { ok: false, latencyMs: Date.now() - startedAt, error: safeError(error) };
  }
}

async function syncEmailAccount(account: EmailAccount, options: EmailSyncOptions) {
  const report: EmailSyncAccountReport = { account: account.email, connected: false, folders: [], errors: [] };
  await prisma.emailAccount.update({ where: { id: account.id }, data: { lastAttemptAt: new Date() } });
  let client: ImapFlow | null = null;
  try {
    client = await createImapClient(account);
    await client.connect();
    report.connected = true;
    const mailboxes = await client.list();
    const sentMailbox = findSentMailbox(mailboxes);
    const targets: Array<{ mailbox: string; direction: 'IN' | 'OUT' }> = [{ mailbox: 'INBOX', direction: 'IN' }];
    if (sentMailbox && sentMailbox.toUpperCase() !== 'INBOX') targets.push({ mailbox: sentMailbox, direction: 'OUT' });

    for (const target of targets) {
      report.folders.push(await syncMailbox(client, account, target.mailbox, target.direction, options));
    }
    await client.logout();
    const folderErrors = report.folders.flatMap((folder) => folder.errors);
    await prisma.emailAccount.update({
      where: { id: account.id },
      data: { lastSuccessAt: new Date(), lastError: folderErrors.length ? folderErrors.join('\n').slice(0, 2000) : null },
    });
  } catch (error) {
    const message = safeError(error);
    report.errors.push(message);
    await prisma.emailAccount.update({ where: { id: account.id }, data: { lastError: message } }).catch(() => undefined);
    client?.close();
  }
  return report;
}

async function createImapClient(account: EmailAccount) {
  const auth = await buildEmailImapAuth(account);
  return new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.isSecure,
    auth,
    logger: false,
    connectionTimeout: 12000,
    greetingTimeout: 12000,
    socketTimeout: 20000,
  });
}

async function syncMailbox(client: ImapFlow, account: EmailAccount, mailbox: string, direction: 'IN' | 'OUT', options: EmailSyncOptions) {
  const cursor = await prisma.emailFolderCursor.findUnique({ where: { accountId_mailbox: { accountId: account.id, mailbox } } });
  const report: FolderReport = {
    mailbox,
    direction,
    fetched: 0,
    inserted: 0,
    updated: 0,
    ignored: 0,
    historyFetched: 0,
    cursorBefore: cursor?.lastUid || null,
    cursorAfter: cursor?.lastUid || null,
    errors: [],
  };
  const lookback = Math.max(10, Math.min(options.lookback || 200, 1000));
  const maxFetch = Math.max(1, Math.min(options.maxFetchPerAccount || 200, 1000));
  const historyBatch = Math.max(0, Math.min(options.historyBatch || 0, 500));
  const lock = await client.getMailboxLock(mailbox);
  try {
    const status = await client.status(mailbox, { messages: true, uidNext: true, uidValidity: true });
    const uidValidity = status.uidValidity ? String(status.uidValidity) : null;
    const cursorIsValid = Boolean(cursor?.lastUid && cursor.uidValidity && uidValidity === cursor.uidValidity);
    const total = status.messages || 0;
    const newestUid = status.uidNext ? Number(status.uidNext) - 1 : null;
    if (total === 0) {
      await markFolderSuccess(account.id, mailbox, direction, uidValidity, cursor?.lastUid || null, cursor?.oldestUid || null, true);
      return report;
    }

    let maxUid = cursorIsValid ? Number(cursor?.lastUid) : 0;
    let oldestUid = cursorIsValid ? Number(cursor?.oldestUid || cursor?.lastUid) : Number.POSITIVE_INFINITY;
    const hasNewMessages = !cursorIsValid || newestUid === null || Number(cursor?.lastUid) < newestUid;
    if (hasNewMessages) {
      const range = cursorIsValid ? `${Number(cursor?.lastUid) + 1}:*` : `${Math.max(1, total - lookback + 1)}:*`;
      let seen = 0;
      for await (const message of client.fetch(range, { source: true, uid: true }, cursorIsValid ? { uid: true } : undefined)) {
        if (seen >= maxFetch) break;
        seen++;
        report.fetched++;
        const uid = Number(message.uid || 0);
        const saved = await persistFetchedEmail(account, mailbox, direction, message).catch((error) => {
          report.errors.push(`uid ${uid}: ${safeError(error)}`);
          return null;
        });
        // 不越过失败 UID；下次从同一位置重试，避免单封异常邮件永久丢失。
        if (!saved) break;
        maxUid = Math.max(maxUid, uid);
        oldestUid = Math.min(oldestUid, uid);
        applyPersistResult(report, saved);
      }
    }

    let historyComplete = cursorIsValid ? cursor?.historyComplete || false : false;
    if (historyBatch > 0 && !historyComplete && Number.isFinite(oldestUid) && oldestUid > 1) {
      const searchResult = await client.search({ uid: `1:${oldestUid - 1}` }, { uid: true });
      const olderUids = Array.isArray(searchResult) ? searchResult : [];
      const selected = olderUids.slice(-historyBatch);
      if (selected.length === 0) {
        historyComplete = true;
      } else {
        let failedHistoryUid: number | null = null;
        for await (const message of client.fetch(selected.join(','), { source: true, uid: true }, { uid: true })) {
          report.fetched++;
          report.historyFetched++;
          const uid = Number(message.uid || 0);
          const saved = await persistFetchedEmail(account, mailbox, direction, message).catch((error) => {
            report.errors.push(`uid ${uid}: ${safeError(error)}`);
            return null;
          });
          if (!saved) {
            failedHistoryUid = uid;
            break;
          }
          oldestUid = Math.min(oldestUid, uid);
          applyPersistResult(report, saved);
        }
        if (failedHistoryUid !== null) {
          oldestUid = Math.max(oldestUid, failedHistoryUid + 1);
          historyComplete = false;
        } else {
          historyComplete = selected.length < historyBatch || oldestUid <= 1;
        }
      }
    }

    const cursorAfter = maxUid > 0 ? String(maxUid) : cursor?.lastUid || null;
    report.cursorAfter = cursorAfter;
    await markFolderSuccess(
      account.id,
      mailbox,
      direction,
      uidValidity,
      cursorAfter,
      Number.isFinite(oldestUid) ? String(oldestUid) : cursor?.oldestUid || null,
      historyComplete,
    );
  } catch (error) {
    const message = safeError(error);
    report.errors.push(message);
    await prisma.emailFolderCursor.upsert({
      where: { accountId_mailbox: { accountId: account.id, mailbox } },
      update: { lastError: message },
      create: { accountId: account.id, mailbox, direction, lastError: message },
    });
  } finally {
    lock.release();
  }
  return report;
}

async function persistFetchedEmail(
  account: EmailAccount,
  mailbox: string,
  direction: 'IN' | 'OUT',
  message: { source?: Buffer | Uint8Array | null; uid?: number | false },
) {
  const parsed: any = await simpleParser(message.source as any);
  const messageId = cleanDbText(parsed.messageId || `imap-${account.id}-${mailbox}-${message.uid}`);
  const from = cleanDbText(parsed.from?.text || parsed.from?.value?.[0]?.address || 'unknown');
  const subject = cleanDbText(parsed.subject || '(无主题)');
  const textBody = cleanDbText(parsed.text || '');
  const htmlBody = typeof parsed.html === 'string' ? cleanDbText(parsed.html) : '';
  const classification = classifyEmail({ from, subject, textBody, htmlBody });
  const disposition = classifyEmailDisposition({ from, subject, textBody, classification, headers: parsed.headers, direction });
  const existing = await prisma.emailMessage.findUnique({ where: { messageId }, select: { id: true, processingState: true } });
  const data = {
    accountId: account.id,
    imapUid: String(message.uid),
    mailbox,
    direction,
    subject,
    from,
    to: cleanDbText(parsed.to?.text || account.email),
    date: parsed.date || new Date(),
    textBody,
    htmlBody,
    isLead: disposition.isBusiness || classification.isLead,
    category: disposition.category,
    categoryReason: disposition.reason,
    classificationScore: disposition.isBusiness ? Math.max(85, classification.classificationScore) : classification.classificationScore,
    actionRequired: direction === 'IN' && (disposition.isBusiness || classification.actionRequired),
    classifiedAt: new Date(),
    classificationTags: disposition.isBusiness
      ? Array.from(new Set([...classification.classificationTags, direction === 'OUT' ? '已发送业务邮件' : '业务邮件']))
      : classification.classificationTags,
  };
  if (existing) {
    const processingState = disposition.ignore
      ? existing.processingState === 'INGESTED' ? 'INGESTED' : 'IGNORED'
      : existing.processingState === 'IGNORED' ? 'RAW' : existing.processingState;
    await prisma.emailMessage.update({
      where: { id: existing.id },
      data: { ...data, processingState },
    });
    return { updated: 1, inserted: 0, ignored: disposition.ignore ? 1 : 0 };
  }
  await prisma.emailMessage.create({ data: { messageId, ...data, processingState: disposition.ignore ? 'IGNORED' : 'RAW' } });
  return { updated: 0, inserted: 1, ignored: disposition.ignore ? 1 : 0 };
}

function applyPersistResult(report: FolderReport, result: { updated: number; inserted: number; ignored: number }) {
  report.updated += result.updated;
  report.inserted += result.inserted;
  report.ignored += result.ignored;
}

export async function processEmailBacklog(options: { limit?: number; enrich?: boolean; automations?: boolean; notifications?: boolean } = {}) {
  const limit = Math.max(1, Math.min(options.limit || 50, 500));
  const emails = await prisma.emailMessage.findMany({
    where: { processingState: { in: ['RAW', 'FAILED'] }, OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }] },
    // 新邮件优先，历史回扫在剩余配额中逐步消化，避免老邮件淹没当天询盘。
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  });
  const report = { selected: emails.length, ingested: 0, duplicate: 0, failed: 0, salesProcessed: 0, errors: [] as string[] };

  for (const email of emails) {
    try {
      if (email.direction === 'IN') {
        const sender = extractInboundCustomer(email.from, email.textBody || '');
        if (!sender.email) {
          await prisma.emailMessage.update({ where: { id: email.id }, data: { processingState: 'IGNORED', lastError: 'no-customer-sender' } });
          continue;
        }
        const latestBody = stripQuotedHistory(email.textBody || '') || email.subject || '';
        const msg: NormalizedMessage = {
          channel: 'EMAIL',
          direction: 'IN',
          externalId: email.messageId,
          threadId: sender.email,
          senderId: sender.email,
          senderName: sender.name || sender.email,
          text: email.subject ? `主题: ${email.subject}\n\n${latestBody}` : latestBody,
          sentAt: email.date,
        };
        const result = await ingestInbound(msg, {
          enrich: options.enrich === true,
          automations: options.automations === true,
          notifications: options.notifications !== false,
        });
        if (result.created) report.ingested++;
        else report.duplicate++;
      } else {
        await persistOutboundInboxMessage(email);
      }

      const salesResult = await processEmailSalesAutomation(email.id);
      if (salesResult.processed) report.salesProcessed++;
      await prisma.emailMessage.update({ where: { id: email.id }, data: { processingState: 'INGESTED', ingestedAt: new Date(), lastError: null, nextRetryAt: null } });
    } catch (error) {
      const message = safeError(error);
      const retryCount = email.retryCount + 1;
      await prisma.emailMessage.update({
        where: { id: email.id },
        data: { processingState: 'FAILED', retryCount, lastError: message, nextRetryAt: new Date(Date.now() + Math.min(24 * 60, 2 ** Math.min(retryCount, 10)) * 60 * 1000) },
      });
      report.failed++;
      report.errors.push(`${email.id}: ${message}`);
    }
  }
  return report;
}

export function classifyEmailDisposition(input: {
  from: string;
  subject: string;
  textBody: string;
  classification: EmailClassification;
  headers?: Map<string, unknown>;
  direction: 'IN' | 'OUT';
}) {
  const fromEmail = extractEmailAddress(input.from);
  const domain = fromEmail.split('@')[1] || '';
  const text = `${input.subject}\n${input.textBody}`.toLowerCase();
  const platformLead = input.direction === 'IN' && isPlatformLead(domain, text);
  const directBusiness = platformLead || BUSINESS_CATEGORIES.has(input.classification.category) || hasDirectBusinessSignal(text);
  const ownInbound = input.direction === 'IN' && OWN_DOMAINS.some((item) => domain === item || domain.endsWith(`.${item}`));
  const listHeader = Boolean(input.headers?.has('list-unsubscribe') || input.headers?.has('list-id'));
  const ignore = ownInbound || (!directBusiness && (NOISE_CATEGORIES.has(input.classification.category) || listHeader || input.direction === 'OUT'));
  return {
    ignore,
    isBusiness: directBusiness && !ownInbound,
    category: platformLead ? 'INQUIRY' : input.classification.category,
    reason: platformLead ? 'platform-customer-lead' : ignore ? (ownInbound ? 'sender-own-domain' : 'noise-without-business-signal') : input.classification.categoryReason,
  };
}

function findSentMailbox(mailboxes: Array<{ path: string; specialUse?: string | null }>) {
  const special = mailboxes.find((mailbox) => mailbox.specialUse === '\\Sent' || mailbox.specialUse?.includes('\\Sent'));
  if (special) return special.path;
  const pattern = /^(.*\/)?(sent|sent[\s_-]?(items|mail|messages)?|gesendet|enviados?|posta[\s_-]?inviata|\[gmail\]\/sent[\s_-]?mail)$/i;
  return mailboxes.find((mailbox) => pattern.test(mailbox.path))?.path || null;
}

function extractInboundCustomer(from: string, body: string) {
  const direct = extractEmailAddress(from);
  const domain = direct.split('@')[1] || '';
  if (direct && !PLATFORM_DOMAINS.some((item) => domain === item || domain.endsWith(`.${item}`))) {
    return { email: direct, name: from.replace(/<[^>]+>/, '').replace(/["']/g, '').trim() };
  }
  const email = body.match(/(?:customer\s*)?(?:e-?mail|邮箱)\s*[:：]\s*([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i)?.[1]?.toLowerCase() || '';
  const name = body.match(/(?:customer\s*)?(?:name|姓名)\s*[:：]\s*([^\n\r]{2,100})/i)?.[1]?.trim() || '';
  return { email, name };
}

async function persistOutboundInboxMessage(email: { messageId: string; to: string; subject: string | null; textBody: string | null; date: Date }) {
  const recipient = extractEmailAddress(email.to);
  if (!recipient) return;
  const contact = await prisma.contact.findFirst({
    where: { OR: [{ emailNormalized: recipient }, { email: { equals: recipient, mode: 'insensitive' } }] },
    select: { companyId: true },
  });
  if (!contact) return;
  const exists = await prisma.inboxMessage.findFirst({ where: { channel: 'EMAIL', externalId: email.messageId }, select: { id: true } });
  if (exists) return;
  await prisma.inboxMessage.create({
    data: {
      channel: 'EMAIL',
      direction: 'OUT',
      externalId: email.messageId,
      threadId: recipient,
      senderId: recipient,
      senderName: recipient,
      originalText: email.subject ? `主题: ${email.subject}\n\n${stripQuotedHistory(email.textBody || '')}` : stripQuotedHistory(email.textBody || ''),
      translatedText: null,
      status: 'REPLIED',
      companyId: contact.companyId,
      sentAt: email.date,
    },
  });
}

function isPlatformLead(domain: string, text: string) {
  if (!PLATFORM_DOMAINS.some((item) => domain === item || domain.endsWith(`.${item}`))) return false;
  return /new (?:quote|inquiry|enquiry)|received a new quote|新询盘|新的报价请求|customer\s*(?:e-?mail|邮箱)\s*[:：]/i.test(text);
}

function hasDirectBusinessSignal(text: string) {
  return /\b(?:rfq|quotation|purchase order|proforma invoice|laser rangefinder|signed contract)\b|询盘|请报价|采购订单|已签合同/i.test(text);
}

async function markFolderSuccess(
  accountId: string,
  mailbox: string,
  direction: string,
  uidValidity: string | null,
  lastUid: string | null,
  oldestUid: string | null,
  historyComplete: boolean,
) {
  await prisma.emailFolderCursor.upsert({
    where: { accountId_mailbox: { accountId, mailbox } },
    update: { direction, uidValidity, lastUid, oldestUid, historyComplete, lastSuccessAt: new Date(), lastError: null },
    create: { accountId, mailbox, direction, uidValidity, lastUid, oldestUid, historyComplete, lastSuccessAt: new Date() },
  });
}

function safeError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/\u0000/g, '').replace(/(?:password|token|secret|authorization)\s*[=:]\s*[^\s,;]+/gi, '$1=[redacted]').slice(0, 800);
}

function cleanDbText(value: unknown) {
  return String(value ?? '').replace(/\u0000/g, '');
}
