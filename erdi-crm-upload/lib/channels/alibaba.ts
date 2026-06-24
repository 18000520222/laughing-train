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
    const payload = rawPayload as any;
    const out: NormalizedMessage[] = [];

    // 尝试从常见结构里取消息数组
    const orderList = payload?.value?.order_list || payload?.value?.orderList || [];
    const list: any[] =
      payload?.messages ||
      payload?.data?.messages ||
      payload?.data?.list ||
      payload?.result?.list ||
      payload?.result?.items ||
      orderList ||
      (Array.isArray(payload) ? payload : []) ||
      [];

    for (const m of list) {
      const text =
        m.content ||
        m.body ||
        m.messageContent ||
        m.subject ||
        m.inquirySubject ||
        (m.trade_id || m.tradeId
          ? `Alibaba order ${m.trade_id || m.tradeId} status: ${m.trade_status || m.tradeStatus || 'unknown'}`
          : '');
      const externalId = m.id || m.messageId || m.inquiryId || m.tradeId || m.trade_id || '';
      out.push({
        channel: 'ALIBABA',
        direction: 'IN',
        externalId: String(externalId),
        threadId: String(m.threadId || m.conversationId || m.buyerId || m.senderId || m.tradeId || m.trade_id || ''),
        senderId: String(m.buyerId || m.senderId || m.fromUserId || m.sales_man_login_id || 'alibaba'),
        senderName: m.buyerName || m.senderName || m.contactName || m.sales_man_login_id || 'Alibaba',
        text: String(text),
        sentAt: m.gmtCreate
          ? new Date(m.gmtCreate)
          : m.create_date?.timestamp
          ? new Date(Number(m.create_date.timestamp))
          : m.createDate?.timestamp
          ? new Date(Number(m.createDate.timestamp))
          : m.timestamp
          ? new Date(Number(m.timestamp))
          : undefined,
      });
    }

    return out;
  }

  /** 通过开放平台消息 API 回复买家 */
  async send(msg: OutboundMessage): Promise<SendResult> {
    const creds = await this.creds();
    if (!creds) return { ok: false, error: '未配置阿里国际站 AppKey/AppSecret/AccessToken' };

    try {
      // 阿里国际站新版网关路径规则：method `alibaba.icbu.xxx.yyy` → 路径 `/icbu/xxx/yyy`
      // 买家消息回复走 ICBU 站内信 API。具体字段以控制台「API 授权」后的文档为准。
      const data = await callAlibaba(
        '/icbu/message/send',
        {
          to_user_id: msg.to,
          content: msg.text,
          ...(msg.threadId ? { conversation_id: msg.threadId } : {}),
        },
        creds
      );

      if (data?.code && data.code !== '0' && data.code !== 0) {
        return { ok: false, error: JSON.stringify(data).slice(0, 300) };
      }
      return { ok: true, externalId: data?.message_id || data?.result?.messageId };
    } catch (err: any) {
      return { ok: false, error: String(err?.message || err) };
    }
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
