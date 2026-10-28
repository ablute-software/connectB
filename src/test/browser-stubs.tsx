// Prompt 923 — two stand-ins for the real-browser tests only (rolldown aliases them): `next/link` as a plain anchor and the auth page shell without its CSS module, so a page can be bundled and rendered without Next.
import type { ReactNode } from 'react';

export default function Link({ href, children, ...rest }: { href: string; children?: ReactNode } & Record<string, unknown>) {
  return <a href={href} {...(rest as Record<string, unknown>)}>{children}</a>;
}

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 16px', background: '#0b4a5a' }}>
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <a href="/" style={{ color: 'rgba(255,255,255,.7)', fontSize: 14 }}>← Back to sherlockdeal.com</a>
        {children}
      </div>
    </div>
  );
}
