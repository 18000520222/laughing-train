import './globals.css'
import TopBar from '@/components/TopBar';
import Sidebar from '@/components/Sidebar';
import { cookies } from 'next/headers';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const loggedIn = !!cookies().get('auth_role')?.value;
  return (
    <html lang="zh">
      <body>
        {loggedIn ? (
          <>
            <Sidebar />
            <TopBar />
            <div className="md:pl-56 transition-all">{children}</div>
          </>
        ) : (
          children
        )}
      </body>
    </html>
  )
}
