// lib/channels/alibaba.ts — 阿里巴巴国际站(Alibaba.com)开放平台渠道适配器
//
// 实现统一 ChannelAdapter:
//   - parseInbound:解析阿里推送(message push)/ poll 拉取的询盘/买家消息 → NormalizedMessage
//   - send:通过开放平台消息 API 回复买家
//   - poll:无 push 时主动轮询新询盘/消息
//
// 阿里国际站开放平台采用 TOP 风格网关:GET/POST 到网关,参数按字典序拼接后
// HMAC(默认 sha256,旧站点用 md5)签名。具体 API method 名以控制台授权为准,
// 这里实现签名与调用骨架,字段映射在拿到真实 payload 后微调即可。

import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { getAlibabaAccessToken } from '@/lib/channels/oauth-tokens';
import type {
  ChannelAdapter,
  NormalizedMessage,
  OutboundMessage,
  SendResult,
} from '@/lib/channels/types';

// 国际站开放平台网关(syncapi 为同步调用网关)
const ALIBABA_GATEWAY = 'https://openapi-api.alibaba.com/rest';

interface AlibabaCreds {
  appKey: string;
  appSecret: string;
  accessToken: string;
}

/** TOP 风格签名:对所有业务参数 + 系统参数按 key 字典序拼接,HMAC-SHA256(appSecret) 大写 hex */
function signParams(params: Record<string, string>, appSecret: string, apiPath: string): string {
  const sortedKeys = Object.keys(params).sort();
  // 新版网关签名:apiPath + 依次拼接 key+value
  let base = apiPath;
  for (const k of sortedKeys) {
    base += k + params[k];
  }
  return crypto.createHmac('sha256', appSecret).update(base, 'utf8').digest('hex').toUpperCase();
}

function formatAlibabaError(data: any): string | null {
  const code = data?.code ?? data?.error_code ?? data?.result_code ?? data?.resultCode;
  if (code === undefined || code === null || code === '0' || code === 0) return null;
  const message = data?.message || data?.error_message || data?.sub_msg || data?.msg || 'Alibaba API error';
  return `${code}: ${message}`;
}

function tryParseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const s = value.trim();
  if (!((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']')))) return value;
  try {
    return JSON.parse(s);
  } catch {
    return value;
  }
}

function normalizePayload(value: unknown): any {
  const parsed = tryParseJson(value);
  if (Array.isArray(parsed)) return parsed.map(normalizePayload);
  if (!parsed || typeof parsed !== 'object') return parsed;

  const obj: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
  for (const key of ['message', 'msg', 'data', 'body', 'payload', 'value', 'content']) {
    if (key in obj) obj[key] = normalizePayload(obj[key]);
  }
  return obj;
}

function collectMessageCandidates(payload: any): any[] {
  const directLists = [
    payload?.messages,
    payload?.messageList,
    payload?.inquiries,
    payload?.inquiryList,
    payload?.data?.messages,
    payload?.data?.list,
    payload?.data?.items,
    payload?.result?.list,
    payload?.result?.items,
    payload?.value?.order_list,
    payload?.value?.orderList,
  ];
  for (const candidate of directLists) {
    if (Array.isArray(candidate) && candidate.length) return candidate;
  }

  const nested = [payload?.message, payload?.msg, payload?.data, payload?.body, payload?.payload, payload?.value];
  for (const candidate of nested) {
    if (!candidate || candidate === payload) continue;
    if (Array.isArray(candidate) && candidate.length) return candidate;
    if (typeof candidate === 'object') {
      const found = collectMessageCandidates(candidate);
      if (found.length) return found;
    }
  }

  if (Array.isArray(payload)) return payload;
  const hasMessageShape = Boolean(
    payload?.content ||
      payload?.body ||
      payload?.messageContent ||
      payload?.text ||
      payload?.subject ||
      payload?.inquirySubject ||
      payload?.trade_id ||
      payload?.tradeId ||
      payload?.orderId
  );
  return hasMessageShape ? [payload] : [];
}

function stableId(value: unknown): string {
  return crypto.createHash('sha1').update(JSON.stringify(value)).digest('hex');
}

function toDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const asNumber = Number(value);
    const date = Number.isFinite(asNumber) && value.length >= 10 ? new Date(asNumber) : new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  if (typeof value === 'object') return toDate((value as any).timestamp ?? (value as any).time);
  return undefined;
}

async function callAlibaba(
  apiPath: string,
  bizParams: Record<string, string>,
  creds: AlibabaCreds,
  method: 'GET' | 'POST' = 'POST'
): Promise<any> {
  const sysParams: Record<string, string> = {
    app_key: creds.appKey,
    access_token: creds.accessToken,
    timestamp: String(Date.now()),
    sign_method: 'sha256',
  };
  const allParams = { ...sysParams, ...bizParams };
  const sign = signParams(allParams, creds.appSecret, apiPath);

  const params = new URLSearchParams({ ...allParams, sign });
  const res = await fetch(
    method === 'GET' ? `${ALIBABA_GATEWAY}${apiPath}?${params.toString()}` : `${ALIBABA_GATEWAY}${apiPath}`,
    {
      method,
      headers: method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined,
      body: method === 'POST' ? params.toString() : undefined,
      signal: AbortSignal.timeout(20000),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`Alibaba HTTP ${res.status}`);
  const apiError = formatAlibabaError(data);
  if (apiError) throw new Error(apiError);
  return data;
}

export class AlibabaAdapter implements ChannelAdapter {
  readonly channel = 'ALIBABA' as const;

  private async creds(): Promise<AlibabaCreds | null> {
    const s = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
    const appKey = s?.alibabaAppKey || process.env.ALIBABA_APP_KEY;
    const appSecret = s?.alibabaAppSecret || process.env.ALIBABA_APP_SECRET;
    // 走刷新中心拿"保证有效"的 access_token(过期自动续期)；无 OAuth 时回退环境变量
    const accessToken = (await getAlibabaAccessToken()) || process.env.ALIBABA_ACCESS_TOKEN || '';
    if (!appKey || !appSecret || !accessToken) return null;
    return { appKey, appSecret, accessToken };
  }

  /**
   * 解析阿里推送/轮询返回的询盘或站内消息。
   * 兼容两种形态:
   *   a) 询盘列表(trade message / inquiry):{ messages: [...] } 或 { data: { ... } }
   *   b) 单条推送 payload
   */
  async parseInbound(rawPayload: unknown): Promise<NormalizedMessage[]> {
    const payload = normalizePayload(rawPayload) as any;
    const out: NormalizedMessage[] = [];

    // 尝试从常见结构里取消息数组,也兼容单条 push 包装。
    const list = collectMessageCandidates(payload);

    for (const m of list) {
      const text =
        m.text ||
        m.content ||
        m.body ||
        m.messageContent ||
        m.message ||
        m.remark ||
        m.subject ||
        m.inquirySubject ||
        m.inquiryName ||
        (m.trade_id || m.tradeId
          ? `Alibaba order ${m.trade_id || m.tradeId} status: ${m.trade_status || m.tradeStatus || 'unknown'}`
          : '');
      if (!String(text || '').trim()) continue;

      const externalId =
        m.id ||
        m.messageId ||
        m.msgId ||
        m.inquiryId ||
        m.inquiry_id ||
        m.tradeId ||
        m.trade_id ||
        m.orderId ||
        m.eventId ||
        m.event_id ||
        stableId(m);
      out.push({
        channel: 'ALIBABA',
        direction: 'IN',
        externalId: String(externalId),
        threadId: String(
          m.threadId ||
            m.conversationId ||
            m.inquiryId ||
            m.inquiry_id ||
            m.buyerId ||
            m.senderId ||
            m.tradeId ||
            m.trade_id ||
            m.orderId ||
            ''
        ),
        senderId: String(
          m.buyerId ||
            m.buyerLoginId ||
            m.senderId ||
            m.fromUserId ||
            m.from ||
            m.contactEmail ||
            m.sales_man_login_id ||
            'alibaba'
        ),
        senderName: m.buyerName || m.senderName || m.contactName || m.companyName || m.sales_man_login_id || 'Alibaba',
        text: String(text),
        sentAt: toDate(m.gmtCreate || m.create_date || m.createDate || m.timestamp || m.gmtModified || m.sendTime),
      });
    }

    return out;
  }

  /** 通过开放平台消息 API 回复买家 */
  async send(_msg: OutboundMessage): Promise<SendResult> {
    const creds = await this.creds();
    if (!creds) return { ok: false, error: '未配置阿里国际站 AppKey/AppSecret/AccessToken' };
    return {
      ok: false,
      error: '阿里当前 App 未开放站内信/询盘发送 API，不能从 CRM 直接回复；请先在阿里后台手动回复。',
    };
  }

  /** 主动轮询新询盘/消息(由定时任务调用 → 交给 ingest pipeline) */
  async poll(): Promise<NormalizedMessage[]> {
    const creds = await this.creds();
    if (!creds) return [];

    // 当前阿里开放平台未给此 App 暴露站内信/询盘列表 API；已授权且官方可用的
    // 交易同步入口是 /alibaba/order/list。后续如阿里开通消息 API，只需替换这里。
    const data = await callAlibaba(
      '/alibaba/order/list',
      { role: 'seller', start_page: '0', page_size: '50' },
      creds,
      'POST'
    );
    return this.parseInbound(data);
  }
}

export const alibabaAdapter = new AlibabaAdapter();
