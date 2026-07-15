import './globals.css'
import TopBar from '@/components/TopBar';
import Sidebar from '@/components/Sidebar';
import { getSession } from '@/lib/auth';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <html lang="zh">
      <body>
        {session ? (
          <>
            <Sidebar role={session.role} />
            <TopBar userName={session.name} role={session.role} />
            <div className="md:pl-56 transition-all">{children}</div>
          </>
        ) : (
          children
        )}
      </body>
    </html>
  )
}
