import { PrismaClient } from '@prisma/client';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';
const prisma = new PrismaClient();

export default async function UsersPage() {
  const cookieStore = cookies();
  const role = cookieStore.get('auth_role')?.value;
  const currentTitle = cookieStore.get('auth_title')?.value || '人员管理';

  if (!role || (role !== 'SUPER_ADMIN' && role !== 'ADMIN')) {
    redirect('/dashboard?error=unauthorized');
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' }
  });

  const roleMap: Record<string, string> = {
    'SUPER_ADMIN': '超级管理员',
    'ADMIN': '管理员',
    'SALES': '业务员',
    'FINANCE': '财务',
    'PURCHASING': '采购',
    'DOCUMENT': '单证',
    'OPERATIONS': '运营'
  };

  async function addUser(formData: FormData) {
    'use server';
    const email = formData.get('email') as string;
    const name = formData.get('name') as string;
    const pwd = formData.get('password') as string;
    const r = formData.get('role') as any;

    if (email && name && pwd) {
      await prisma.user.create({
        data: { email, name, password: pwd, role: r }
      });
      revalidatePath('/users');
    }
  }

  async function toggleStatus(formData: FormData) {
    'use server';
    const id = formData.get('id') as string;
    const currentStatus = formData.get('isActive') === 'true';
    if (id) {
      await prisma.user.update({
        where: { id },
        data: { isActive: !currentStatus }
      });
      revalidatePath('/users');
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 p-8 font-sans">
      <header className="mb-8 flex justify-between items-center bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 tracking-tight">ERDI 员工账号与权限管理</h1>
          <p className="text-sm text-gray-500 mt-1">当前登录: {currentTitle} | 仅超级管理员和管理员可见</p>
        </div>
        <div className="flex gap-4">
          <Link href="/dashboard" className="px-5 py-2.5 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 transition-colors">
            返回看板
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-6 border-b border-gray-100 bg-gray-50/50">
            <h2 className="text-lg font-bold text-gray-800">员工名册 ({users.length})</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-sm border-b border-gray-100">
                  <th className="p-4 font-medium">姓名 / 邮箱</th>
                  <th className="p-4 font-medium">角色权限</th>
                  <th className="p-4 font-medium">状态</th>
                  <th className="p-4 font-medium">加入时间</th>
                  <th className="p-4 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map(u => (
                  <tr key={u.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="p-4">
                      <div className="font-bold text-gray-800">{u.name}</div>
                      <div className="text-sm text-gray-500">{u.email}</div>
                    </td>
                    <td className="p-4">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-indigo-50 text-indigo-700">
                        {roleMap[u.role] || u.role}
                      </span>
                    </td>
                    <td className="p-4">
                      {u.isActive ? (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700 ring-1 ring-inset ring-green-600/20">
                          在职 / 激活
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20">
                          已离职 / 停用
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-sm text-gray-500">
                      {u.createdAt.toLocaleDateString()}
                    </td>
                    <td className="p-4 text-right">
                      <form action={toggleStatus}>
                        <input type="hidden" name="id" value={u.id} />
                        <input type="hidden" name="isActive" value={u.isActive.toString()} />
                        <button type="submit" className={'text-sm font-medium ' + (u.isActive ? 'text-red-600 hover:text-red-800' : 'text-green-600 hover:text-green-800')}>
                          {u.isActive ? '停用账号' : '恢复激活'}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 h-fit sticky top-8">
          <h2 className="text-lg font-bold text-gray-800 mb-6 flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">👤</span>
            新增员工账号
          </h2>
          <form action={addUser} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">员工姓名</label>
              <input type="text" name="name" required className="w-full border border-gray-200 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 outline-none transition-all" placeholder="例如：张三" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">登录邮箱</label>
              <input type="email" name="email" required className="w-full border border-gray-200 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 outline-none transition-all" placeholder="例如：zhangsan@erdicn.com" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">初始密码</label>
              <input type="text" name="password" required className="w-full border border-gray-200 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 outline-none transition-all" placeholder="设置初始密码" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">账号角色 (决定权限)</label>
              <select name="role" required className="w-full border border-gray-200 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 outline-none transition-all bg-white">
                <option value="SALES">业务员 (仅看自己数据)</option>
                <option value="PURCHASING">采购专员 (管理供应商)</option>
                <option value="DOCUMENT">单证员 (管理报关与物流)</option>
                <option value="FINANCE">财务专员 (看全局数据)</option>
                <option value="ADMIN">管理员 (可管人)</option>
                <option value="SUPER_ADMIN">超级管理员 (最高权限)</option>
              </select>
            </div>
            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg transition-colors shadow-sm mt-2">
              + 创建账号
            </button>
            <p className="text-xs text-gray-500 mt-4 leading-relaxed">
              * 员工离职后，请点击左侧列表的「停用账号」，这会保留其名下客户数据，但禁止其登录系统。
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
