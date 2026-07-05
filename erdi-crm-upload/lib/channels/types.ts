// lib/channels/types.ts — 统一渠道适配器接口
//
// 每个渠道(WhatsApp / 阿里国际站 / 亚马逊 / Shopee)实现 ChannelAdapter,
// 新增渠道只需写一个适配器 + 在 registry 注册,中台逻辑(翻译/AI回复/收件箱)全复用。

export type ChannelType = 'WHATSAPP' | 'ALIBABA' | 'AMAZON' | 'SHOPEE' | 'FACEBOOK' | 'INSTAGRAM' | 'LINKEDIN' | 'EMAIL' | 'SALESMARTLY';

export type Direction = 'IN' | 'OUT';

/** 渠道无关的标准化入站消息(适配器把各平台原始 payload 转成这个) */
export interface NormalizedMessage {
  channel: ChannelType;
  direction: Direction;
  /** 平台侧消息唯一 id(用于去重) */
  externalId?: string;
  /** 平台侧会话/线程 id(同一客户的对话归并) */
  threadId?: string;
  /** 对方标识:手机号 / 平台用户名 / 店铺账号等 */
  senderId: string;
  /** 对方显示名 */
  senderName?: string;
  /** 原始正文(客户语言) */
  text: string;
  /** 媒体附件 URL/ID(可选) */
  mediaUrl?: string;
  /** 平台原始时间(可选,缺省用入库时间) */
  sentAt?: Date;
}

/** 发送消息的入参 */
export interface OutboundMessage {
  /** 对方标识(手机号/用户名/会话id,取决于渠道) */
  to: string;
  /** 要发送的最终文本(已是客户语言) */
  text: string;
  /** 关联会话/线程(可选) */
  threadId?: string;
}

export interface SendResult {
  ok: boolean;
  externalId?: string;
  error?: string;
}

/**
 * 渠道适配器接口。
 * - parseInbound:把平台 webhook/轮询的原始数据解析成标准消息数组
 * - send:把回复发回平台
 * - 不在适配器里做翻译/AI,那些由中台统一处理(ingest pipeline)
 */
export interface ChannelAdapter {
  readonly channel: ChannelType;

  /** 解析平台原始 payload → 标准消息(一次可能含多条) */
  parseInbound(rawPayload: unknown): Promise<NormalizedMessage[]>;

  /** 发送一条消息到平台 */
  send(msg: OutboundMessage): Promise<SendResult>;

  /** (可选)主动轮询拉取新消息,用于无 webhook 的渠道如亚马逊 */
  poll?(): Promise<NormalizedMessage[]>;
}
