// lib/channels/shopee.ts — 虾皮 Shopee Open Platform 渠道适配器
//
// 实现统一 ChannelAdapter:
//   - parseInbound:解析 Shopee 聊天 webhook(push)payload → NormalizedMessage
//   - send:调用 Shopee Chat API 回复买家
//   - poll:预留(Shopee 主推 webhook,一般无需轮询)
//   - verifySign:校验 Shopee push 的签名(HMAC-SHA256(partner_key))
//
// Shopee 签名:base_string = partner_id + api_path + timestamp + access_token + shop_id
// sign = HMAC-SHA256(partner_key, base_string)。请求里附 partner_id/timestamp/access_token/shop_id/sign。

import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { getShopeeAccessToken } from '@/lib/channels/oauth-tokens';
import type {
  ChannelAdapter,
  NormalizedMessage,
  OutboundMessage,
  SendResult,
} from '@/lib/channels/types';

interface ShopeeCreds {
  partnerId: string;
  partnerKey: string;
  shopId: string;
  accessToken: string;
  base: string;
}

function sign(partnerKey: string, baseString: string): string {
  return crypto.createHmac('sha256', partnerKey).update(baseString, 'utf8').digest('hex');
}

export class ShopeeAdapter implements ChannelAdapter {
  readonly channel = 'SHOPEE' as const;

  private async creds(): Promise<ShopeeCreds | null> {
    const s = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
    const partnerId = s?.shopeePartnerId || process.env.SHOPEE_PARTNER_ID;
    const partnerKey = s?.shopeePartnerKey || process.env.SHOPEE_PARTNER_KEY;
    const shopId = s?.shopeeShopId || process.env.SHOPEE_SHOP_ID;
    const accessToken = (await getShopeeAccessToken()) || process.env.SHOPEE_ACCESS_TOKEN || '';
    if (!partnerId || !partnerKey || !shopId || !accessToken) return null;
    return {
      partnerId,
      partnerKey,
      shopId,
      accessToken,
      base: s?.shopeeRegion || 'https://partner.shopeemobile.com',
    };
  }

  /** 构造已签名的完整请求 URL(shop 级 API) */
  private signedUrl(apiPath: string, creds: ShopeeCreds): string {
    const ts = Math.floor(Date.now() / 1000);
    const baseString = `${creds.partnerId}${apiPath}${ts}${creds.accessToken}${creds.shopId}`;
    const s = sign(creds.partnerKey, baseString);
    const qs = new URLSearchParams({
      partner_id: creds.partnerId,
      timestamp: String(ts),
      access_token: creds.accessToken,
      shop_id: creds.shopId,
      sign: s,
    });
    return `${creds.base}${apiPath}?${qs.toString()}`;
  }

  /**
   * 校验 Shopee push 签名。
   * Shopee push 的 Authorization 头 = HMAC-SHA256(partner_key, url + '|' + raw_body)。
   */
  async verifySign(url: string, rawBody: string, authHeader: string): Promise<boolean> {
    const creds = await this.creds();
    if (!creds) return false;
    const expected = sign(creds.partnerKey, `${url}|${rawBody}`);
    return expected === authHeader;
  }

  /** 解析 Shopee 聊天 webhook payload(code=10:新消息) */
  async parseInbound(rawPayload: unknown): Promise<NormalizedMessage[]> {
    const payload = rawPayload as any;
    const out: NormalizedMessage[] = [];

    // Shopee push: { code, shop_id, data: { ... } }
    const d = payload?.data || payload;
    const contents: any[] = d?.content
      ? [d.content]
      : d?.messages || (Array.isArray(d) ? d : []);

    for (const c of contents) {
      // 只处理买家发来的(from_id != shop_id 时一般为买家)
      const text =
        c.content?.text ||
        c.text ||
        (typeof c.content === 'string' ? c.content : '') ||
        c.message ||
        '';
      out.push({
        channel: 'SHOPEE',
        direction: 'IN',
        externalId: String(c.message_id || c.msg_id || c.id || ''),
        threadId: String(c.conversation_id || c.to_id || c.from_id || ''),
        senderId: String(c.from_id || c.from_user_id || c.buyer_id || ''),
        senderName: c.from_user_name || c.buyer_name || undefined,
        text: String(text),
        sentAt: c.created_timestamp
          ? new Date(Number(c.created_timestamp) * 1000)
          : undefined,
      });
    }

    return out;
  }

  /** 通过 Shopee Chat API 回复买家 */
  async send(msg: OutboundMessage): Promise<SendResult> {
    const creds = await this.creds();
    if (!creds) return { ok: false, error: '未配置 Shopee 凭据(partnerId/partnerKey/shopId/accessToken)' };

    try {
      const url = this.signedUrl('/api/v2/sellerchat/send_message', creds);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to_id: Number(msg.to) || msg.to,
          message_type: 'text',
          content: { text: msg.text },
        }),
        signal: AbortSignal.timeout(20000),
      });
      const data = await res.json();
      if (data?.error) {
        return { ok: false, error: JSON.stringify(data).slice(0, 300) };
      }
      return { ok: true, externalId: data?.response?.message_id };
    } catch (err: any) {
      return { ok: false, error: String(err?.message || err) };
    }
  }
}

export const shopeeAdapter = new ShopeeAdapter();
