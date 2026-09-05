'use client';
// BLOCO 3 — the back-office console gets its OWN chrome, completely
// separate from the founder Shell (src/components/shell.tsx early-returns
// bare children for this route). Client-side redirect here is a UX nicety
// only — the real 403 is enforced server-side in middleware.ts and
// independently in every /api/backoffice/* route (requirePlatformAdmin()).
//
// Prompt 576 §3 — the flat top-nav-bar chrome this file used to render
// directly is replaced by BackofficeShell (the same WorkspaceSidebar/
// WorkspaceHeader the founder shell uses, in its own 6-group configuration —
// see that component's own header for why it's a sibling rather than a
// branch inside <Shell>). No route in this tree changes; every existing
// page under /backoffice/* renders exactly where it already did.
import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BackofficeShell } from '@/components/backoffice/BackofficeShell';
import { useUsageHeartbeat } from '@/lib/use-usage-heartbeat';

export default function BackofficeLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-gray-400">Loading…</div>}>
      <BackofficeLayoutContent>{children}</BackofficeLayoutContent>
    </Suspense>
  );
}

function BackofficeLayoutContent({ children }: { children: React.ReactNode }) {
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
