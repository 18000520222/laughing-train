import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function retired() {
  return NextResponse.json(
    {
      error: '该初始化入口已永久停用。数据库变更必须通过经过审核的增量迁移执行。',
    },
    { status: 410 },
  );
}

export async function GET() {
  return retired();
}

export async function POST() {
  return retired();
}
