import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export default async function LoginPage(props: any) {
  async function login(formData: FormData) {
    'use server';
    const role = String(formData.get('role'));
    const pwd = String(formData.get('password'));

    // 分发不同身份的通行证 (Cookie)
    if (role === 'sales' && pwd === 'sales666') {
      cookies().set('auth_role', 'sales', { path: '/' });
      redirect('/dashboard');
    } else if (role === 'finance' && pwd === 'finance888') {
      cookies().set('auth_role', 'finance', { path: '/' });
      redirect('/finance');
    } else {
      redirect('/?error=1');
    }
  }

  const sp = await props.searchParams;
  const hasError = sp?.error === '1';

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white p-10 rounded-2xl shadow-xl w-full max-w-md border border-gray-200">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black text-gray-800 tracking-tight">ERDI CRM</h1>
          <p className="text-gray-500 mt-2">私有化业务指挥中心</p>
        </div>
        
        {hasError && (
          <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-6 text-sm text-center font-medium border border-red-100">
            ❌ 密码不正确，请重新输入
          </div>
        )}

        <form action={login} className="space-y-5">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">👤 登录身份</label>
            <select name="role" className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-blue-500 outline-none">
              <option value="sales">业务主理人 (Kanban 视图)</option>
              <option value="finance">财务审计 (数据报表视图)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">🔑 访问密码</label>
            <input type="password" name="password" required className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="输入专属密码" />
          </div>
          <button type="submit" className="w-full bg-gray-900 hover:bg-black text-white font-bold py-3.5 rounded-lg shadow-md transition-all mt-4">
            安全登录
          </button>
        </form>
      </div>
    </div>
  );
}
