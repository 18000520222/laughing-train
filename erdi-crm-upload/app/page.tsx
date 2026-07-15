import { prisma } from '@/lib/prisma';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createSession, normalizeRole } from '@/lib/auth';
import bcrypt from 'bcryptjs';



export default async function LoginPage(props: any) {
  async function login(formData: FormData) {
    'use server';
    const email = String(formData.get('email')).trim().toLowerCase();
    const pwd = String(formData.get('password'));
    const requestHeaders = await headers();
    const ipAddress = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim()
      || requestHeaders.get('x-real-ip')
      || null;

    // 去数据库核实账号密码
    const user = await prisma.user.findUnique({
      where: { email: email },
    });

    // 账号必须存在且激活(未离职)
    if (!user || !user.isActive || (user.lockedUntil && user.lockedUntil > new Date())) {
      await prisma.loginAttempt.create({
        data: { email, ipAddress, success: false, reason: user?.lockedUntil ? 'LOCKED' : 'INVALID_ACCOUNT' },
      });
      redirect('/?error=1');
    }

    // 密码校验:bcrypt 哈希优先;兼容历史明文密码,验证通过后自动升级为哈希(渐进迁移,不锁死任何人)。
    const stored = user.password || '';
    const isHashed = stored.startsWith('$2');
    let ok = false;
    if (isHashed) {
      ok = await bcrypt.compare(pwd, stored);
    } else {
      ok = stored === pwd;
      if (ok) {
        // 明文校验通过 → 立即升级为 bcrypt 哈希
        try {
          const hash = await bcrypt.hash(pwd, 10);
          await prisma.user.update({ where: { id: user.id }, data: { password: hash } });
        } catch {}
      }
    }
    if (!ok) {
      const nextFailures = user.failedLoginCount + 1;
      await prisma.$transaction([
        prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: nextFailures >= 5 ? 0 : nextFailures,
            lockedUntil: nextFailures >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null,
          },
        }),
        prisma.loginAttempt.create({
          data: { email, ipAddress, success: false, reason: nextFailures >= 5 ? 'RATE_LIMITED' : 'INVALID_PASSWORD' },
        }),
      ]);
      redirect('/?error=1');
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
      }),
      prisma.loginAttempt.create({ data: { email, ipAddress, success: true, reason: 'SUCCESS' } }),
      prisma.auditLog.create({
        data: {
          actorId: user.id,
          actorEmail: user.email,
          actorRole: String(user.role),
          action: 'AUTH_LOGIN',
          entityType: 'User',
          entityId: user.id,
          summary: '员工登录 CRM',
          ipAddress,
          userAgent: requestHeaders.get('user-agent')?.slice(0, 500) || null,
        },
      }),
    ]);

    // 签发签名 JWT 会话(httpOnly)，与 middleware 校验打通。
    // JWT 内部存规范化(大写)角色，供未来统一鉴权使用。
    await createSession({
      userId: user.id,
      email: user.email,
      name: user.name || '未知',
      role: normalizeRole(user.role as string),
      sessionVersion: user.sessionVersion,
      mustChangePassword: user.mustChangePassword,
    });

    if (user.mustChangePassword) redirect('/account/password');

    // 财务去财务室，业务去看板
    if (normalizeRole(user.role) === 'FINANCE') {
      redirect('/finance');
    }
    redirect('/dashboard');
  }

  const searchParams = props.searchParams;
  const hasError = searchParams.error === "1";

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-gray-800 rounded-3xl shadow-2xl overflow-hidden border border-gray-700">
        <div className="p-8">
          <div className="text-center mb-10">
            <h1 className="text-4xl font-black text-white tracking-tighter mb-2">ERDI CRM</h1>
            <p className="text-gray-400 text-sm uppercase tracking-widest font-bold">企业级业务协同中心</p>
          </div>

          <form action={login} className="space-y-6">
            {hasError && (
              <div className="bg-red-900/50 border border-red-500 text-red-200 p-4 rounded-xl text-sm font-medium animate-pulse">
                ❌ 账号或密码不正确，或账号已被禁用
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 ml-1">👤 登录邮箱</label>
              <input
                name="email"
                type="email"
                required
                className="w-full bg-gray-900 border-2 border-gray-700 rounded-xl px-4 py-3 text-white focus:border-indigo-500 focus:outline-none transition-all"
                placeholder="email@erdicn.com"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 ml-1">🔑 访问密码</label>
              <input
                name="password"
                type="password"
                required
                className="w-full bg-gray-900 border-2 border-gray-700 rounded-xl px-4 py-3 text-white focus:border-indigo-500 focus:outline-none transition-all"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 rounded-xl shadow-lg shadow-indigo-500/20 transform hover:-translate-y-1 transition-all active:scale-95"
            >
              安全登录
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
