import { PrismaClient } from '@prisma/client';
import { NextResponse } from 'next/server';

const prisma = new PrismaClient();

export async function GET() {
  try {
    // 1. 初始化系统设置（美元汇率默认7.2）
    await prisma.systemSettings.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default', usdToCnyRate: 7.2, companyName: 'ERDI TECH LTD' }
    });

    // 2. 初始化员工数据库
    const users = [
      { email: 'sales@erdicn.com', password: 'sales666', name: '业务主账号', role: 'SUPER_ADMIN' },
      { email: 'yilin@erdimail.com', password: 'erdi123', name: 'Yilin', role: 'SALES' },
      { email: 'niro@erdimail.com', password: 'erdi123', name: 'Niro', role: 'SALES' },
      { email: 'lyn@erdimail.com', password: 'erdi123', name: 'Lyn', role: 'SALES' },
      { email: 'yeva@erdimail.com', password: 'erdi123', name: 'Yeva', role: 'SALES' },
      { email: 'venk@erdicn.com', password: 'erdi123', name: 'Venk', role: 'SALES' },
      { email: '18628970297@163.com', password: 'finance888', name: '财务审计', role: 'FINANCE' }
    ];

    for (const u of users) {
      await prisma.user.upsert({
        where: { email: u.email },
        update: {},
        create: {
          email: u.email,
          password: u.password,
          name: u.name,
          // @ts-ignore - 忽略ts类型检查以确保直接写入
          role: u.role
        }
      });
    }

    return NextResponse.json({ message: '✅ 数据库初始化成功！员工账号已全部创建。' });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
