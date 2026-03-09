import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FVG Macro Screener',
  description: 'AI-powered confluencia screener: Smart Money Concepts + macro context en tiempo real',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="dark">
      <body className="min-h-screen bg-[#06060a] text-slate-200 antialiased">
        {children}
      </body>
    </html>
  );
}
