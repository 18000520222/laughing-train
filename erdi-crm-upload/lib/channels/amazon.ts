// lib/channels/amazon.ts — 亚马逊 SP-API 渠道适配器
//
// 亚马逊没有买家消息 webhook(站内信),主要靠:
//   - poll:轮询「待回复的买家消息」/订单,生成 NormalizedMessage 交给 ingest pipeline
//   - send:通过 SP-API Messaging API 给买家发消息(受场景模板限制)
//
// 鉴权:LWA(Login with Amazon)refresh_token → access_token(1h 有效,自动刷新)。
// SP-API endpoint 按 region 区分:na / eu / fe。
//
// 注意:SP-API 的买家消息能力受限(只能在特定订单场景下发模板消息),
// 真正的「客服聊天」需要买卖家消息授权。这里实现 token 刷新 + 调用骨架,
// 拿到授权后按实际 operation 微调。

import { prisma } from '@/lib/prisma';
import type {
  ChannelAdapter,
  NormalizedMessage,
  OutboundMessage,
  SendResult,
} from '@/lib/channels/types';

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

const SP_ENDPOINTS: Record<string, string> = {
  na: 'https://sellingpartnerapi-na.amazon.com',
  eu: 'https://sellingpartnerapi-eu.amazon.com',
  fe: 'https://sellingpartnerapi-fe.amazon.com',
};

interface AmazonCreds {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  sellerId?: string;
  marketplaceId: string;
  endpoint: string;
}

// access_token 进程内缓存(1h 有效,留 5min 余量)
let cachedToken: { value: string; expiresAt: number } | null = null;

export class AmazonAdapter implements ChannelAdapter {
  readonly channel = 'AMAZON' as const;

  private async creds(): Promise<AmazonCreds | null> {
    const s = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
    const refreshToken = s?.amazonRefreshToken || process.env.AMAZON_REFRESH_TOKEN;
    const clientId = s?.amazonLwaClientId || process.env.AMAZON_LWA_CLIENT_ID;
    const clientSecret = s?.amazonLwaClientSecret || process.env.AMAZON_LWA_CLIENT_SECRET;
    if (!refreshToken || !clientId || !clientSecret) return null;
    const region = (s?.amazonRegion || 'na').toLowerCase();
    return {
      refreshToken,
      clientId,
      clientSecret,
      sellerId: s?.amazonSellerId || undefined,
      marketplaceId: s?.amazonMarketplaceId || 'ATVPDKIKX0DER',
      endpoint: SP_ENDPOINTS[region] || SP_ENDPOINTS.na,
    };
  }

  /** 用 refresh_token 换 access_token(带缓存) */
  private async accessToken(creds: AmazonCreds): Promise<string | null> {
    if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
    try {
      const res = await fetch(LWA_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: creds.refreshToken,
          client_id: creds.clientId,
          client_secret: creds.clientSecret,
        }).toString(),
        signal: AbortSignal.timeout(15000),
      });
      const data = await res.json();
      if (!res.ok || !data.access_token) return null;
      cachedToken = {
        value: data.access_token,
        expiresAt: Date.now() + (Number(data.expires_in || 3600) - 300) * 1000,
      };
      return cachedToken.value;
    } catch {
      return null;
    }
  }

  private async spFetch(
    path: string,
    method: string,
    creds: AmazonCreds,
    body?: unknown
  ): Promise<any> {
    const token = await this.accessToken(creds);
    if (!token) throw new Error('LWA access_token 获取失败');
    const res = await fetch(`${creds.endpoint}${path}`, {
      method,
      headers: {
        'x-amz-access-token': token,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    return res.json();
  }

  /**
   * 解析 SP-API 返回的订单/消息列表 → NormalizedMessage。
   * 这里以「订单」为线索(每个待处理订单 = 一个潜在对话),拿到买卖家消息授权后
   * 可换成真正的消息 operation。
   */
  async parseInbound(rawPayload: unknown): Promise<NormalizedMessage[]> {
    const payload = rawPayload as any;
    const out: NormalizedMessage[] = [];

    const orders: any[] = payload?.payload?.Orders || payload?.Orders || [];
    for (const o of orders) {
      out.push({
        channel: 'AMAZON',
        direction: 'IN',
        externalId: String(o.AmazonOrderId || ''),
        threadId: String(o.AmazonOrderId || ''),
        senderId: String(o.BuyerInfo?.BuyerEmail || o.AmazonOrderId || ''),
        senderName: o.BuyerInfo?.BuyerName || undefined,
        text:
          o.OrderStatus
            ? `[订单 ${o.AmazonOrderId}] 状态:${o.OrderStatus} 金额:${o.OrderTotal?.Amount || ''} ${o.OrderTotal?.CurrencyCode || ''}`
            : `[订单 ${o.AmazonOrderId}]`,
        sentAt: o.PurchaseDate ? new Date(o.PurchaseDate) : undefined,
      });
    }

    // 兼容直接传消息列表的情况
    const msgs: any[] = payload?.messages || [];
    for (const m of msgs) {
      out.push({
        channel: 'AMAZON',
        direction: 'IN',
        externalId: String(m.id || m.messageId || ''),
        threadId: String(m.orderId || m.threadId || ''),
        senderId: String(m.buyerEmail || m.buyerId || ''),
        senderName: m.buyerName || undefined,
        text: String(m.text || m.body || ''),
        sentAt: m.createdAt ? new Date(m.createdAt) : undefined,
      });
    }

    return out;
  }

  /** 给买家发消息(SP-API Messaging,受场景模板限制) */
  async send(msg: OutboundMessage): Promise<SendResult> {
    const creds = await this.creds();
    if (!creds) return { ok: false, error: '未配置亚马逊 SP-API 凭据(refreshToken/clientId/clientSecret)' };

    const orderId = msg.threadId || msg.to;
    try {
      // 示意:确认订单详情类消息。真实 operation 需按订单可用 actions 选择。
      const path = `/messaging/v1/orders/${encodeURIComponent(orderId)}/messages/confirmOrderDetails?marketplaceIds=${creds.marketplaceId}`;
      const data = await this.spFetch(path, 'POST', creds, { text: msg.text });

      if (data?.errors?.length) {
        return { ok: false, error: JSON.stringify(data.errors).slice(0, 300) };
      }
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: String(err?.message || err) };
    }
  }

  /** 轮询最近订单作为对话线索 */
  async poll(): Promise<NormalizedMessage[]> {
    const creds = await this.creds();
    if (!creds) return [];
    try {
      // 拉最近 24h 创建的订单
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const path = `/orders/v0/orders?MarketplaceIds=${creds.marketplaceId}&CreatedAfter=${encodeURIComponent(since)}`;
      const data = await this.spFetch(path, 'GET', creds);
      return this.parseInbound(data);
    } catch {
      return [];
    }
  }
}

export const amazonAdapter = new AmazonAdapter();
