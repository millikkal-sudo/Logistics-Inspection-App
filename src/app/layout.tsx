import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

/**
 * Healthy Sans is proprietary and will not be on a supervisor's phone. Inter
 * is the documented fallback in the Healthy UI token file and renders on
 * brand adjacent everywhere.
 */
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '700', '800', '900'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Van Check | Calo',
  description: 'Pre-departure quality checks for Calo chilled delivery vans',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  // Must be a literal: a meta tag cannot read a CSS custom property.
  // This is --fill-brand-bold (brand-90).
  themeColor: '#114B34',
};

const RootLayout = ({ children }: { children: React.ReactNode }) => (
  <html lang="en" className={inter.variable}>
    <body className="bg-surface-page font-sans antialiased">{children}</body>
  </html>
);

export default RootLayout;
