import type { Metadata } from 'next';
import './globals.css';
import { StoreProvider } from '@/lib/store';
import { Shell } from '@/components/shell';
import { ReportProblemWidget } from '@/components/ReportProblemWidget';
import { BottomNavHeightProvider } from '@/lib/bottom-nav-context';
import { ConfirmProvider } from '@/lib/confirm';
import { BRAND_NAME } from '@/lib/brand';

export const metadata: Metadata = {
  title: `${BRAND_NAME} — Investor Relations`,
  description: `${BRAND_NAME} — the Investor Relations Management platform that enforces outreach discipline. Founders, investors and the platform team in one place.`,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Comfortaa:wght@700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
        <StoreProvider>
          <BottomNavHeightProvider>
            <ConfirmProvider>
              <Shell>{children}</Shell>
              <ReportProblemWidget />
            </ConfirmProvider>
          </BottomNavHeightProvider>
        </StoreProvider>
      </body>
    </html>
  );
}
