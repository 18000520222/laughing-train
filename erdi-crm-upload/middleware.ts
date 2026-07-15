import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose/jwt/verify';

const SESSION_COOKIE = 'erdi_session';

// Paths that never require a session JWT.
// 这些路由要么是公开页面，要么自带鉴权(webhook 签名 / cron key / OAuth callback)。
const PUBLIC_PATHS = ['/'];
const PUBLIC_PREFIXES = [
  '/_next/',
  '/favicon',
  '/api/auth/',        // OAuth start/callback
  '/api/webhook',      // 通用 webhook(自带签名校验)
  '/api/webhooks/',    // Meta unified webhook 等复数形式
  '/api/shopline',     // SHOPLINE webhook
  '/api/agent/',       // Codex/WeChat bridge API (Bearer token protected)
  '/api/whatsapp/webhook',
  '/api/facebook/webhook',
  '/api/alibaba/webhook',  // 阿里国际站消息推送
  '/api/shopee/webhook',   // Shopee push
  '/api/salesmartly/webhook',
  '/api/chatwoot/webhook',
  '/api/tracking/webhook',
  '/api/tracking/sync', // AfterShip poller (session or CRON_SECRET protected)
  '/api/cron/',        // 定时任务(自带 ?key= / Bearer 校验)
  '/api/automation/bootstrap', // 自动化蓝图运维补齐(自带 ?key= / Bearer 校验)
  '/api/automation/runs/replay', // 自动化运行重放(自带 ?key= / Bearer 校验)
  '/api/automation/runs/bulk-replay', // 自动化失败运行批量恢复(自带 ?key= / Bearer 校验)
  '/api/emails/classify', // 邮件历史分类回填(自带 ?key= / Bearer 校验)
  '/api/emails/label-plan', // Gmail/邮件标签映射只读计划(自带 ?key= / Bearer 校验)
  '/api/tasks/calendar', // ICS 日历订阅(自带签名 token / session 校验)
];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

async function valid(token: string | undefined): Promise<{ mustChangePassword: boolean } | null> {
  if (!token) return null;
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    return { mustChangePassword: Boolean(payload.mustChangePassword) };
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const session = await valid(req.cookies.get(SESSION_COOKIE)?.value);
  if (session) {
    if (session.mustChangePassword && pathname !== '/account/password' && pathname !== '/api/auth/logout') {
      const url = req.nextUrl.clone();
      url.pathname = '/account/password';
      url.search = '';
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // Unauthenticated: APIs get 401 JSON, pages get redirected to login.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = '/';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
