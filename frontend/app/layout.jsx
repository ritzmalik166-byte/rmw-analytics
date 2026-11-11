import { Inter } from 'next/font/google';
import { Toaster } from 'sonner';
import { QueryProvider } from '@/providers/QueryProvider';
import { AuthProvider } from '@/providers/AuthProvider';
import { MaintenanceGate } from '@/components/MaintenanceGate';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

export const metadata = {
  title: { default: 'RMW Analytics', template: '%s · RMW Analytics' },
  description: 'Website analytics and visitor intelligence for MPF, RMW, CT and client websites',
  icons: { icon: '/rmw-mark.png', apple: '/rmw-mark.png' },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans">
        <QueryProvider>
          <AuthProvider>{children}</AuthProvider>
        </QueryProvider>
        <MaintenanceGate />
        <Toaster richColors position="top-right" closeButton />
      </body>
    </html>
  );
}
