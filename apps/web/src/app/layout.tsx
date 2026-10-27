import type { Metadata, Viewport } from 'next';
import { connection } from 'next/server';
// Fonts ship with the app (no Google Fonts request), so it also works offline at an event.
import '@fontsource/kanit/400.css';
import '@fontsource/kanit/600.css';
import '@fontsource/kanit/800.css';
import '@fontsource/ibm-plex-sans-thai/400.css';
import '@fontsource/ibm-plex-sans-thai/600.css';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: { default: 'MFEC IceBreaker Arena', template: '%s · MFEC IceBreaker Arena' },
  description: 'เกมควิซและไอซ์เบรกเกอร์สำหรับทีม MFEC: สร้างคำถามเอง แข่งเก็บคะแนน หลายด่าน',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0b0b2b',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // every page renders per request: proxy.ts gives each one a fresh nonce, and a page built ahead of time has none
  await connection();
  return (
    <html lang="th">
      <body className="arena-bg min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
