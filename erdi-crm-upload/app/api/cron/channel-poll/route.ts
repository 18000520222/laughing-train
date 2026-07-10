// /api/cron/channel-poll — 统一渠道轮询入口
//
// 遍历所有支持 poll 的渠道适配器(阿里/亚马逊/Shopee),拉取新消息 → ingestInbound
// 复用中台 pipeline(去重/翻译/客户关联/AI 草稿)。
// 未配置凭据的渠道 poll() 返回 [],自动跳过。
//
// 鉴权:生产使用环境变量 key 或 Vercel Cron 的 Authorization: Bearer。
// GitHub Actions 每 10 分钟触发。

import { NextRequest, NextResponse } from 'next/server';
import { pollableAdapters } from '@/lib/channels/registry';
import { ingestInbound } from '@/lib/inbox';
import { isCronAuthorized } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const POLL_KEY = process.env.CHANNEL_POLL_KEY;
const CHANNEL_POLL_TIMEOUT_MS = 12000;

function timeoutAfter(ms: number, channel: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`${channel} poll timed out after ${ms}ms`)), ms);
  });
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req, [POLL_KEY], ['erdi-channel-2026'])) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const report: any[] = [];

  for (const adapter of pollableAdapters()) {
    const channelReport: any = { channel: adapter.channel, fetched: 0, ingested: 0, duplicate: 0, skipped: 0, errors: 0 };
    try {
      const messages = await Promise.race([
        adapter.poll!(),
        timeoutAfter(CHANNEL_POLL_TIMEOUT_MS, adapter.channel),
      ]);
      channelReport.fetched = messages.length;

      for (const msg of messages) {
        try {
          const res = await ingestInbound(msg);
          if (res.created) channelReport.ingested++;
          else if (res.skippedReason === 'duplicate') channelReport.duplicate++;
          else channelReport.skipped++;
        } catch (err: any) {
          channelReport.errors++;
          channelReport.errorSamples ||= [];
          if (channelReport.errorSamples.length < 3) {
            channelReport.errorSamples.push(String(err?.message || err).slice(0, 200));
          }
        }
      }
    } catch (err: any) {
      channelReport.pollError = String(err?.message || err).slice(0, 200);
    }
    report.push(channelReport);
  }

  return NextResponse.json({ ok: true, ts: new Date().toISOString(), report });
}
