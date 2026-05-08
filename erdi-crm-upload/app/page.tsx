import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

// 🏢 企业员工账号库 (新增了 venk@erdicn.com)
const USERS = [
  { email: 'sales@erdicn.com',     password: 'sales666',   role: 'sales',   title: '业务主账号' },
  { email: 'yilin@erdimail.com',   password: 'erdi123',    role: 'sales',   title: '业务代表' },
  { email: 'niro@erdimail.com',    password: 'erdi123',    role: 'sales',   title: '业务代表' },
  { email: 'lyn@erdimail.com',     password: 'erdi123',    role: 'sales',   title: '业务代表' },
  { email: 'yeva@erdimail.com',    password: 'erdi123',    role: 'sales',   title: '业务代表' },
  { email: 'venk@erdicn.com',      password: 'erdi123',    role: 'sales',   title: '业务代表' },
  { email: '18628970297@163.com',  password: 'finance888', role: 'finance', title: '财务审计' }
];

export default async function LoginPage(props: any) {
  async function login(formData: FormData) {
    'use server';
    const email = String(formData.get('email')).trim().toLowerCase();
    const pwd = String(formData.get('password'));

    // 匹配账号密码
    const user = USERS.find(u => u.email === email && u.password === pwd);

    if (user) {
      // 发放通行证并记录身份
      cookies().set('auth_role', user.role, { path: '/' });
      cookies().set('auth_email', user.email, { path: '/' });
      cookies().set('auth_title', user.title, { path: '/' });
      
      // 根据角色分发到不同页面
      if (user.role === 'sales') {
        redirect('/dashboard');
      } else {
        redirect('/finance');
      }
    } else {
      // 密码错误
      redirect('/?error=1');
    }
  }

  const resolvedParams = await props.searchParams;
  const hasError = resolvedParams?.error === '1';

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white p-10 rounded-2xl shadow-xl w-full max-w-md border border-gray-200 relative overflow-hidden">
        {/* 装饰光晕 */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50 rounded-full blur-3xl -mr-10 -mt-10 opacity-60"></div>
        
        <div className="text-center mb-8 relative z-10">
          <h1 className="text-3xl font-black text-gray-800 tracking-tight">ERDI CRM</h1>
          <p className="text-gray-500 mt-2">企业级业务协同中心</p>
        </div>
        
        {hasError && (
          <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-6 text-sm text-center font-medium border border-red-100 relative z-10">
            ❌ 账号或密码不正确，请重新输入
          </div>
        )}

        <form action={login} className="space-y-5 relative z-10">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">👤 登录邮箱</label>
            <input 
              type="email" 
              name="email" 
              required 
              className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-blue-500 outline-none" 
              placeholder="例如: yilin@erdimail.com" 
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">🔑 访问密码</label>
            <input 
              type="password" 
              name="password" 
              required 
              className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-blue-500 outline-none" 
              placeholder="输入初始密码" 
            />
          </div>
          <button type="submit" className="w-full bg-gray-900 hover:bg-black text-white font-bold py-3.5 rounded-lg shadow-md transition-all mt-4">
            安全登录
          </button>
        </form>
      </div>
    </div>
  );
}
