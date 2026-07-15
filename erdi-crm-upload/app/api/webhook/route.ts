import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { isWebhookTokenAuthorized } from '@/lib/webhook-auth';
import { ingestInbound } from '@/lib/inbox';
import { createHash } from 'crypto';



// 允许跨域请求 (CORS)，这一步是为了以后浏览器插件能顺利把数据推送过来
export async function OPTIONS() {
  return NextResponse.json({}, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

// 接收外部数据的核心逻辑
export async function POST(request: Request) {
  try {
    // 1. 安全锁：校验通关密语（优先读环境变量 WEBHOOK_TOKEN，未配置时回退旧值保持兼容）
    if (!isWebhookTokenAuthorized(request, [process.env.WEBHOOK_TOKEN])) {
      return NextResponse.json({ error: '安全拦截：Token 错误' }, { status: 401 });
    }

    // 2. 读取外部传进来的数据包
    const data = await request.json();

    // 3. 智能解析数据（兼容不同平台传来的格式）
    const customerName = data.name || data.customer || '未知访客';
    const customerEmail = data.email || data.contact || '未留邮箱';
    const message = data.message || data.content || data.description || '无留言内容';
    const source = data.source || '官方网站 (erdicn.com)';

    if (!String(customerEmail).includes('@')) {
      return NextResponse.json({ error: '必须提供有效客户邮箱' }, { status: 400 });
    }
    const externalId = String(data.id || data.externalId || createHash('sha256').update(`${source}|${customerEmail}|${message}`).digest('hex'));
    const ingested = await ingestInbound({
      channel: 'EMAIL',
      direction: 'IN',
      externalId: `website:${externalId}`,
      threadId: `website:${customerEmail}`,
      senderId: String(customerEmail).trim().toLowerCase(),
      senderName: String(customerName),
      text: `Website inquiry from ${source}\n\n${message}`,
      sentAt: new Date(),
    });
    let opportunityId: string | null = null;
    if (ingested.created && ingested.inboxId) {
      const inbox = await prisma.inboxMessage.findUnique({ where: { id: ingested.inboxId }, select: { companyId: true, company: { select: { ownerId: true } } } });
      if (inbox?.companyId) {
        const opportunity = await prisma.opportunity.create({
          data: {
            title: `网站询盘 · ${source}`,
            stage: 'UNPROCESSED',
            companyId: inbox.companyId,
            ownerId: inbox.company?.ownerId || null,
            description: String(message),
          },
        });
        opportunityId = opportunity.id;
      }
    }

    // 5. 告诉发送方：接收成功！
    return NextResponse.json({
      success: true,
      message: '成功存入 CRM',
      id: opportunityId,
      duplicate: !ingested.created,
    }, {
      headers: {
        'Access-Control-Allow-Origin': '*',
      }
    });

  } catch (error: any) {
    console.error('Webhook Error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
