'use client';
// Prompt 587 §C — extracted verbatim from src/app/backoffice/layout.tsx so
// /metrics can reuse the exact same auth-gate + BackofficeShell wrapping
// instead of a second copy that could drift. BLOCO 3's own reasoning still
// applies: client-side redirect here is a UX nicety only — the real 403 is
// enforced server-side in middleware.ts (both /backoffice/* and /metrics
// are in its BLOCO 3 gate) and independently in every /api/backoffice/*
// route (requirePlatformAdmin()).
import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BackofficeShell } from './BackofficeShell';
import { useUsageHeartbeat } from '@/lib/use-usage-heartbeat';

export function PlatformAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-gray-400">Loading…</div>}>
      <PlatformAdminLayoutContent>{children}</PlatformAdminLayoutContent>
    </Suspense>
  );
}

function PlatformAdminLayoutContent({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<{ authEnabled: boolean; role: string; user: { email?: string } | null } | null>(null);

  useEffect(() => {
    fetch('/api/me').then((r) => r.json()).then(setMe).catch(() => setMe({ authEnabled: false, role: 'none', user: null }));
  }, []);

  // Prompt 295 §1 — separate context from the founder shell's own 'crm'
  // heartbeat: a dual-role account (Nuno) genuinely uses two different
  // shells, and this table should be able to tell them apart.
  useUsageHeartbeat({ context: 'backoffice', enabled: me?.authEnabled === true && me?.role === 'developer' });

  useEffect(() => {
    if (me && me.authEnabled && me.role !== 'developer') router.replace('/pipeline');
  }, [me, router]);

  if (me?.authEnabled && me.role !== 'developer') {
    return <div className="flex min-h-screen items-center justify-center text-sm text-gray-400">403 — platform admin only.</div>;
  }

  return (
    <BackofficeShell me={me?.user ? { email: me.user.email, role: me.role } : null}>
      {children}
    </BackofficeShell>
  );
}
