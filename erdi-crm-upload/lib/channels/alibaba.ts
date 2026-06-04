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

async function callAlibaba(
  apiPath: string,
  bizParams: Record<string, string>,
  creds: AlibabaCreds
): Promise<any> {
  const sysParams: Record<string, string> = {
    app_key: creds.appKey,
    access_token: creds.accessToken,
    timestamp: String(Date.now()),
    sign_method: 'sha256',
  };
  const allParams = { ...sysParams, ...bizParams };
  const sign = signParams(allParams, creds.appSecret, apiPath);

  const body = new URLSearchParams({ ...allParams, sign });
  const res = await fetch(`${ALIBABA_GATEWAY}${apiPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(20000),
  });
  return res.json();
}

export class AlibabaAdapter implements ChannelAdapter {
  readonly channel = 'ALIBABA' as const;

  private async creds(): Promise<AlibabaCreds | null> {
    const s = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
    const appKey = s?.alibabaAppKey || process.env.ALIBABA_APP_KEY;
    const appSecret = s?.alibabaAppSecret || process.env.ALIBABA_APP_SECRET;
    const accessToken = s?.alibabaAccessToken || process.env.ALIBABA_ACCESS_TOKEN;
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
    const list: any[] =
      payload?.messages ||
      payload?.data?.messages ||
      payload?.data?.list ||
      (Array.isArray(payload) ? payload : []) ||
      [];

    for (const m of list) {
      const text =
        m.content || m.body || m.messageContent || m.subject || m.inquirySubject || '';
      out.push({
        channel: 'ALIBABA',
        direction: 'IN',
        externalId: String(m.id || m.messageId || m.inquiryId || m.tradeId || ''),
        threadId: String(m.threadId || m.conversationId || m.buyerId || m.senderId || ''),
        senderId: String(m.buyerId || m.senderId || m.fromUserId || ''),
        senderName: m.buyerName || m.senderName || m.contactName || undefined,
        text: String(text),
        sentAt: m.gmtCreate
          ? new Date(m.gmtCreate)
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
      // method 以控制台授权的消息发送 API 为准(示意:alibaba.message.send)
      const data = await callAlibaba(
        '/alibaba/message/send',
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

    try {
      // method 以控制台授权的询盘列表 API 为准(示意:alibaba.inquiry.list)
      const data = await callAlibaba(
        '/alibaba/inquiry/list',
        { page_size: '50', page: '1' },
        creds
      );
      return this.parseInbound(data);
    } catch {
      return [];
    }
  }
}

export const alibabaAdapter = new AlibabaAdapter();
