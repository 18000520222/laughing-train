import { PrismaClient } from '@prisma/client';
import { NextResponse } from 'next/server';

const prisma = new PrismaClient();

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
    // 1. 隐形安全锁：检查网址里有没有正确的通关密语
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');
    
    // 这里的 erdi2026 就是我们的密语，不对的话系统拒收！
    if (token !== 'erdi2026') {
      return NextResponse.json({ error: '安全拦截：Token 错误' }, { status: 401 });
    }

    // 2. 读取外部传进来的数据包
    const data = await request.json();
    
    // 3. 智能解析数据（兼容不同平台传来的格式）
    const customerName = data.name || data.customer || '未知访客';
    const customerEmail = data.email || data.contact || '未留邮箱';
    const message = data.message || data.content || data.description || '无留言内容';
    const source = data.source || '官方网站 (erdicn.com)';

    // 4. 将数据直接写入 CRM 数据库的“新询盘”列
    const newOpp = await prisma.opportunity.create({
      data: {
        title: `新询盘 来自 ${source}`,
        stage: 'SPEC_CONFIRMING', // 默认进入“新询盘确认”阶段
        companyId: `${customerName} (${customerEmail})`,
        description: `🌍 来源平台: ${source}\n👤 客户姓名: ${customerName}\n📧 联系邮箱: ${customerEmail}\n\n📝 留言内容:\n${message}\n\n---\n系统自动接收于: ${new Date().toLocaleString()}`,
        amount: 0,
      }
    });

    // 5. 告诉发送方：接收成功！
    return NextResponse.json({ success: true, message: '成功存入 CRM', id: newOpp.id }, {
      headers: {
        'Access-Control-Allow-Origin': '*',
      }
    });

  } catch (error: any) {
    console.error('Webhook Error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
