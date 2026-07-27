'use client';
// Contact & Support — the discreet "Help & support" entry point for the two
// authenticated surfaces (founder sidebar, investor portal). A trigger that
// opens the same ContactForm in a small modal, pre-filled from the session
// so the visitor doesn't have to retype what we already know.
import { useEffect, useState } from 'react';
import { authEnabled, browserClient } from '@/lib/supabase';
import { ContactForm, type SupportSource } from './ContactForm';

export function HelpSupportWidget({ source, className }: { source: SupportSource; className?: string }) {
  const [open, setOpen] = useState(false);
  const [defaultName, setDefaultName] = useState('');
  const [defaultEmail, setDefaultEmail] = useState('');

  useEffect(() => {
    if (!authEnabled) return;
    browserClient().auth.getUser().then(({ data }) => {
      const meta = data.user?.user_metadata as { full_name?: string } | undefined;
      setDefaultName(meta?.full_name ?? '');
      setDefaultEmail(data.user?.email ?? '');
    });
  }, []);

  return (
    <>
      <button onClick={() => setOpen(true)}
        className={className ?? 'flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600'}>
        <span aria-hidden="true">◈</span> Help &amp; support
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">Help &amp; support</h2>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700">✕</button>
            </div>
            <ContactForm source={source} defaultName={defaultName} defaultEmail={defaultEmail}
              showContext={source === 'founder_app'} />
          </div>
        </div>
      )}
    </>
  );
}
