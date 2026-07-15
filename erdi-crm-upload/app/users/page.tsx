import bcrypt from 'bcryptjs';
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { ROLES, normalizeRole, type Role } from '@/lib/auth';
import { requirePermission } from '@/lib/permissions';
import { writeAuditLog } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: '超级管理员',
  ADMIN: '管理员',
  SALES: '业务员',
  PURCHASING: '采购',
  FINANCE: '财务',
  DOCUMENT: '单证',
  OPERATIONS: '运营',
};

function passwordIsValid(value: string) {
  return value.length >= 12 && /[A-Za-z]/.test(value) && /\d/.test(value);
}

export default async function UsersPage({ searchParams }: { searchParams?: Promise<{ error?: string; ok?: string }> }) {
  const session = await requirePermission('users.manage');
  const query = searchParams ? await searchParams : {};
  const users = await prisma.user.findMany({ orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }] });

  async function addUser(formData: FormData) {
    'use server';
    const actor = await requirePermission('users.manage');
    const email = String(formData.get('email') || '').trim().toLowerCase();
    const name = String(formData.get('name') || '').trim();
    const password = String(formData.get('password') || '');
    const role = normalizeRole(String(formData.get('role') || 'SALES'));
    if (!email || !name || !passwordIsValid(password)) redirect('/users?error=password');
    if (role === 'SUPER_ADMIN' && actor.role !== 'SUPER_ADMIN') redirect('/users?error=forbidden');

    const hash = await bcrypt.hash(password, 12);
    try {
      const user = await prisma.user.create({
        data: { email, name, password: hash, role, mustChangePassword: true },
      });
      await writeAuditLog(actor, {
        action: 'USER_CREATED', entityType: 'User', entityId: user.id,
        summary: `创建员工账号 ${email}`, metadata: { role },
      });
    } catch {
      redirect('/users?error=duplicate');
    }
    revalidatePath('/users');
    redirect('/users?ok=created');
  }

  async function updateUser(formData: FormData) {
    'use server';
    const actor = await requirePermission('users.manage');
    const id = String(formData.get('id') || '');
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) redirect('/users?error=missing');

    const nextRole = normalizeRole(String(formData.get('role') || target.role));
    const nextActive = formData.get('isActive') === 'true';
    const protectedTarget = target.role === 'SUPER_ADMIN' && actor.role !== 'SUPER_ADMIN';
    if (protectedTarget || (target.id === actor.userId && !nextActive)) redirect('/users?error=forbidden');
    if (nextRole === 'SUPER_ADMIN' && actor.role !== 'SUPER_ADMIN') redirect('/users?error=forbidden');

    await prisma.user.update({
      where: { id },
      data: {
        role: nextRole,
        isActive: nextActive,
        sessionVersion: { increment: 1 },
      },
    });
    await writeAuditLog(actor, {
      action: 'USER_UPDATED', entityType: 'User', entityId: id,
      summary: `更新员工 ${target.email} 的角色或状态`,
      metadata: { previousRole: target.role, role: nextRole, previousActive: target.isActive, isActive: nextActive },
    });
    revalidatePath('/users');
    redirect('/users?ok=updated');
  }

  async function resetPassword(formData: FormData) {
    'use server';
    const actor = await requirePermission('users.manage');
    const id = String(formData.get('id') || '');
    const password = String(formData.get('password') || '');
    if (!passwordIsValid(password)) redirect('/users?error=password');
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target || (target.role === 'SUPER_ADMIN' && actor.role !== 'SUPER_ADMIN')) redirect('/users?error=forbidden');

    await prisma.user.update({
      where: { id },
      data: {
        password: await bcrypt.hash(password, 12),
        mustChangePassword: true,
        passwordChangedAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
        sessionVersion: { increment: 1 },
      },
    });
    await writeAuditLog(actor, {
      action: 'USER_PASSWORD_RESET', entityType: 'User', entityId: id,
      summary: `管理员重置员工 ${target.email} 的密码并注销旧会话`,
    });
    revalidatePath('/users');
    redirect('/users?ok=password');
  }

  const errorMessage = {
    password: '密码至少 12 位，并同时包含字母和数字。',
    duplicate: '该邮箱已存在。',
    forbidden: '不允许修改该账号或执行该操作。',
    missing: '员工账号不存在。',
  }[query.error || ''];

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <h1 className="text-2xl font-black text-slate-900">员工账号与权限</h1>
          <p className="mt-1 text-sm text-slate-500">角色决定菜单和数据操作权限；停用、改角色、重置密码会立即注销旧会话。</p>
        </div>
        <Link href="/account/password" className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700">修改我的密码</Link>
      </header>

      {errorMessage && <div className="mb-5 rounded-xl bg-rose-50 p-4 text-sm font-bold text-rose-700">{errorMessage}</div>}
      {query.ok && <div className="mb-5 rounded-xl bg-emerald-50 p-4 text-sm font-bold text-emerald-700">操作已完成。</div>}

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-4 font-black text-slate-800">员工名册（{users.length}）</div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-bold text-slate-500"><tr><th className="p-4">员工</th><th className="p-4">权限与状态</th><th className="p-4">最近登录</th><th className="p-4">管理</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((user) => {
                  const locked = Boolean(user.lockedUntil && user.lockedUntil > new Date());
                  const canManageTarget = session.role === 'SUPER_ADMIN' || user.role !== 'SUPER_ADMIN';
                  return (
                    <tr key={user.id} className="align-top">
                      <td className="p-4"><div className="font-black text-slate-900">{user.name || '未命名'}</div><div className="text-xs text-slate-500">{user.email}</div></td>
                      <td className="p-4"><div className="font-semibold text-indigo-700">{ROLE_LABEL[normalizeRole(user.role)]}</div><div className={`mt-1 text-xs font-bold ${user.isActive ? 'text-emerald-600' : 'text-rose-600'}`}>{user.isActive ? '在职 / 激活' : '停用'}{locked ? ' · 登录锁定' : ''}{user.mustChangePassword ? ' · 待改密码' : ''}</div></td>
                      <td className="p-4 text-xs text-slate-500">{user.lastLoginAt ? user.lastLoginAt.toLocaleString('zh-CN') : '尚未登录'}</td>
                      <td className="p-4">
                        {canManageTarget ? <div className="space-y-3">
                          <form action={updateUser} className="flex flex-wrap gap-2">
                            <input type="hidden" name="id" value={user.id} />
                            <select name="role" defaultValue={user.role} className="rounded border border-slate-200 px-2 py-1.5 text-xs">
                              {ROLES.filter((role) => session.role === 'SUPER_ADMIN' || role !== 'SUPER_ADMIN').map((role) => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
                            </select>
                            <select name="isActive" defaultValue={String(user.isActive)} className="rounded border border-slate-200 px-2 py-1.5 text-xs"><option value="true">激活</option><option value="false">停用</option></select>
                            <button className="rounded bg-slate-900 px-3 py-1.5 text-xs font-bold text-white">保存</button>
                          </form>
                          <form action={resetPassword} className="flex flex-wrap gap-2">
                            <input type="hidden" name="id" value={user.id} />
                            <input name="password" type="password" required minLength={12} placeholder="临时密码（至少12位）" className="w-44 rounded border border-slate-200 px-2 py-1.5 text-xs" />
                            <button className="rounded border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700">重置密码</button>
                          </form>
                        </div> : <span className="text-xs text-slate-400">仅超级管理员可操作</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="h-fit rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-black text-slate-900">新增员工</h2>
          <p className="mt-1 text-xs text-slate-500">员工首次登录必须修改临时密码。</p>
          <form action={addUser} className="mt-5 space-y-4">
            <Field name="name" label="员工姓名" />
            <Field name="email" label="登录邮箱" type="email" />
            <Field name="password" label="临时密码" type="password" minLength={12} />
            <label className="block text-sm font-semibold text-slate-700">角色
              <select name="role" defaultValue="SALES" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5">
                {ROLES.filter((role) => session.role === 'SUPER_ADMIN' || role !== 'SUPER_ADMIN').map((role) => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
              </select>
            </label>
            <button className="w-full rounded-lg bg-indigo-600 px-4 py-3 font-black text-white hover:bg-indigo-500">创建员工账号</button>
          </form>
        </div>
      </div>
    </div>
  );
}

function Field({ name, label, type = 'text', minLength }: { name: string; label: string; type?: string; minLength?: number }) {
  return <label className="block text-sm font-semibold text-slate-700">{label}<input name={name} type={type} minLength={minLength} required className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5" /></label>;
}
