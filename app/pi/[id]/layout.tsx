import './globals.css' // 引入全局样式，Tailwind 才会生效

export const metadata = {
  title: 'ERDI CRM',
  description: 'ERDI TECH LTD Private CRM System',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
