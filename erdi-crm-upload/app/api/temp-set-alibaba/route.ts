import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    { error: '该临时密钥写入接口已停用，请在 /settings/channels 中保存阿里凭据。' },
    { status: 410 }
  );
}

export async function POST() {
  return NextResponse.json(
    { error: '该临时密钥写入接口已停用，请在 /settings/channels 中保存阿里凭据。' },
    { status: 410 }
  );
}
