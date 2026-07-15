import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function retired() {
  return NextResponse.json(
    { error: '旧版样例线索导入已永久停用；请使用自动 Gmail 同步和邮件分类流程。' },
    { status: 410 },
  );
}

export async function GET() {
  return retired();
}

export async function POST() {
  return retired();
}
