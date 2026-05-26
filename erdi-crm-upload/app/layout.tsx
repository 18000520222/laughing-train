import './globals.css'
import TopBar from '@/components/TopBar';
import { cookies } from 'next/headers';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const loggedIn = !!cookies().get('auth_role')?.value;
  return (
    <html lang="zh">
      <body>
        {loggedIn && <TopBar />}
        {children}
      </body>
    </html>
  )
}
