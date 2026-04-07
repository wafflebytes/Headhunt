import './globals.css';
import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { Toaster } from '@/components/ui/sonner';
import AgentationProvider from '@/components/AgentationProvider';

const anthropicSans = localFont({
  src: '../fonts/anthropicSans.ttf',
  variable: '--font-anthropic-sans',
  display: 'swap',
});

const styreneA = localFont({
  src: '../fonts/styreneA.ttf',
  variable: '--font-styrene-a',
  display: 'swap',
});

const copernicus = localFont({
  src: '../fonts/copernicus.ttf',
  variable: '--font-copernicus',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Headhunt Dashboard',
  description: 'Headhunt operator dashboard and onboarding experience.',
  icons: {
    icon: '/images/favicon.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${anthropicSans.variable} ${styreneA.variable} ${copernicus.variable}`}>
      <body className="antialiased font-sans">
        {children}
        <AgentationProvider />
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: '#1f3347',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '16px',
              boxShadow: '0 15px 30px rgba(0,0,0,0.25)',
              fontFamily: 'var(--font-anthropic-sans), sans-serif',
              color: 'white',
            },
            descriptionClassName: 'text-[#a0afbb] text-[12px] mt-1',
          }}
        />
      </body>
    </html>
  );
}
