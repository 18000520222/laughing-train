// lib/channels/registry.ts — 渠道适配器注册中心
//
// 所有渠道适配器在此统一注册。中台逻辑(轮询/发送/webhook)通过 getAdapter(channel)
// 拿到对应适配器,新增渠道只需 import + 加进 map。

import type { ChannelAdapter, ChannelType } from '@/lib/channels/types';
import { whatsappAdapter } from '@/lib/channels/whatsapp';
import { alibabaAdapter } from '@/lib/channels/alibaba';
import { amazonAdapter } from '@/lib/channels/amazon';
import { shopeeAdapter } from '@/lib/channels/shopee';

const REGISTRY: Partial<Record<ChannelType, ChannelAdapter>> = {
  WHATSAPP: whatsappAdapter,
  ALIBABA: alibabaAdapter,
  AMAZON: amazonAdapter,
  SHOPEE: shopeeAdapter,
};

/** 取某渠道的适配器(未注册返回 undefined) */
export function getAdapter(channel: ChannelType): ChannelAdapter | undefined {
  return REGISTRY[channel];
}

/** 所有已注册的渠道适配器 */
export function allAdapters(): ChannelAdapter[] {
  return Object.values(REGISTRY).filter(Boolean) as ChannelAdapter[];
}

/** 支持主动轮询(poll)的适配器(用于定时拉取无 webhook 的渠道) */
export function pollableAdapters(): ChannelAdapter[] {
  return allAdapters().filter((a) => typeof a.poll === 'function');
}
