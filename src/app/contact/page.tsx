'use client';
// Contact & Support — the public entry point, linked from the footer of
// both landing sides. Same standalone frosted-glass treatment as
// login/signup (AuthShell) rather than the full landing chrome — this is a
// utility page, not a marketing one. `?from=investors` (set by the
// /investors footer link) is the only thing that decides which `source`
// gets recorded; nothing else about the form changes between the two.
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AuthShell } from '@/components/auth/AuthShell';
import { ContactForm } from '@/components/ContactForm';
import { LogoLockup } from '@/components/Logo';

function ContactInner() {
  const sp = useSearchParams();
  const source = sp.get('from') === 'investors' ? 'landing_investors' : 'landing';

  return (
    <AuthShell>
      <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-7 shadow-2xl">
        <div className="mb-1 flex items-center gap-2 text-2xl font-bold tracking-tight text-[#0E7490]" style={{ fontFamily: 'Comfortaa, Inter, sans-serif' }}>
          <LogoLockup size={28} accentClassName="text-[#2a7f8e]" />
        </div>
        <p className="mb-5 text-sm text-gray-500">
          Got a question, found a bug, or something doesn&apos;t look right? Tell us here — we read every message.
        </p>
        <ContactForm source={source} />
      </div>
    </AuthShell>
  );
}

export default function ContactPage() {
  return <Suspense fallback={null}><ContactInner /></Suspense>;
}
