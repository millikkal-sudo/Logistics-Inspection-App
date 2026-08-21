import type { Metadata, Viewport } from 'next';
import { Archivo } from 'next/font/google';
import './globals.css';

const archivo = Archivo({
  subsets: ['latin'],
  weight: ['500', '700', '800'],
  variable: '--font-archivo',
});

export const metadata: Metadata = {
  title: 'Van Check — Calo UAE',
  description: 'Pre-departure quality check for chilled delivery vans',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#08466F',
};

const RootLayout = ({ children }: { children: React.ReactNode }) => (
  <html lang="en" className={archivo.variable}>
    <body className="font-sans antialiased">{children}</body>
  </html>
);

export default RootLayout;
