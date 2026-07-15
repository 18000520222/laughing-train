import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST() {
  return NextResponse.json(
    { error: '旧版邮件入站接口已停用；Gmail 邮件统一由 OAuth/IMAP 自动同步链路处理。' },
    { status: 410 },
  );
}
