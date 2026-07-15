import bcrypt from 'bcryptjs';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { createSession, normalizeRole } from '@/lib/auth';
import { requireSession } from '@/lib/permissions';
import { writeAuditLog } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export default async function PasswordPage({ searchParams }: { searchParams?: Promise<{ error?: string }> }) {
  const session = await requireSession();
  const query = searchParams ? await searchParams : {};

  async function changePassword(formData: FormData) {
    'use server';
    const current = await requireSession();
    const oldPassword = String(formData.get('oldPassword') || '');
    const password = String(formData.get('password') || '');
    const confirm = String(formData.get('confirm') || '');

    if (password !== confirm || password.length < 12 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      redirect('/account/password?error=policy');
    }

    const user = await prisma.user.findUnique({ where: { id: current.userId } });
    if (!user || !(await bcrypt.compare(oldPassword, user.password))) {
      redirect('/account/password?error=current');
    }

    const nextVersion = user.sessionVersion + 1;
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: passwordHash,
        mustChangePassword: false,
        passwordChangedAt: new Date(),
        sessionVersion: nextVersion,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    await writeAuditLog(current, {
      action: 'AUTH_PASSWORD_CHANGED',
      entityType: 'User',
      entityId: user.id,
      summary: '员工修改登录密码并使旧会话失效',
    });
    await createSession({
      userId: user.id,
      email: user.email,
      name: user.name || user.email,
      role: normalizeRole(user.role),
      sessionVersion: nextVersion,
      mustChangePassword: false,
    });
    redirect('/dashboard?password=changed');
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-10">
      <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-black text-slate-900">修改登录密码</h1>
        <p className="mt-2 text-sm text-slate-500">首次登录、管理员重置密码后必须完成。新密码至少 12 位，并同时包含字母和数字。</p>
        {query.error && (
          <div className="mt-5 rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-700">
            {query.error === 'current' ? '当前密码不正确。' : '新密码不符合规则或两次输入不一致。'}
          </div>
        )}
        <form action={changePassword} className="mt-6 space-y-4">
          <PasswordField name="oldPassword" label="当前密码" />
          <PasswordField name="password" label="新密码" />
          <PasswordField name="confirm" label="确认新密码" />
          <button className="w-full rounded-lg bg-slate-900 px-5 py-3 font-bold text-white hover:bg-slate-800">保存并重新登录所有设备</button>
        </form>
        <div className="mt-5 text-xs text-slate-400">当前账号：{session.email}</div>
      </div>
    </div>
  );
}

function PasswordField({ name, label }: { name: string; label: string }) {
  return (
    <label className="block text-sm font-semibold text-slate-700">
      {label}
      <input name={name} type="password" required autoComplete="new-password" className="mt-1 w-full rounded-lg border border-slate-300 px-4 py-3 outline-none focus:border-indigo-500" />
    </label>
  );
}
