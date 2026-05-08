import { PrismaClient } from '@prisma/client';
import { NextResponse } from 'next/server';

const prisma = new PrismaClient();

export async function POST(request: Request) {
  try {
    // 验证密语，防止伪造数据
    const { searchParams } = new URL(request.url);
    if (searchParams.get('token') !== 'erdi2026') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await request.json();
    console.log("收到 SHOPLINE 推送数据:", JSON.stringify(payload).substring(0, 200));

    // SHOPLINE 的表单提交事件，或者客户创建事件
    // 我们尝试从 payload 中提取联系人和留言信息 (兼容多种事件格式)
    const customerEmail = payload.email || payload.customer?.email || '未提供邮箱';
    const customerName = payload.first_name || payload.customer?.first_name || 'SHOPLINE 官网访客';
    const phone = payload.phone || payload.customer?.phone || '未提供电话';
    
    // 如果是询盘留言事件，提取内容，否则记为普通联系人
    const note = payload.note || payload.message || '官网访客触发了事件，但未提取到具体留言内容。';

    // 写入 CRM 的新询盘看板
    const newOpp = await prisma.opportunity.create({
      data: {
        title: `官网新询盘 (Shopline)`,
        stage: 'SPEC_CONFIRMING',
        companyId: `${customerName} (${customerEmail})`,
        description: `🌍 来源平台: SHOPLINE (erdicn.com)\n👤 客户姓名: ${customerName}\n📧 联系邮箱: ${customerEmail}\n📞 联系电话: ${phone}\n\n📝 备注/留言:\n${note}\n\n---\n接收时间: ${new Date().toLocaleString()}`,
        amount: 0,
      }
    });

    return NextResponse.json({ success: true, message: 'Shopline data stored', id: newOpp.id });

  } catch (error: any) {
    console.error('Shopline Webhook Error:', error);
    return NextResponse.json({ error: 'Server Error' }, { status: 500 });
  }
}
