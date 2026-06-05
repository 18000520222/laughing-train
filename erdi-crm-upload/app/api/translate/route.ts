// app/api/translate/route.ts
import { NextResponse } from 'next/server';
import { translateText } from '@/lib/translate';
import { prisma } from '@/lib/prisma';



export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { text, target = 'zh', source = 'auto' } = body;

    if (!text) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }

    const settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
    const baseUrl = settings?.libretranslateUrl || 'https://libretranslate.com';

    const result = await translateText(text, target, source, baseUrl);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}
