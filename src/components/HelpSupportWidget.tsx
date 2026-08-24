'use client';
// Contact & Support — the discreet "Help & support" entry point for the two
// authenticated surfaces (founder sidebar, investor portal). A trigger that
// opens the same ContactForm in a small modal, pre-filled from the session
// so the visitor doesn't have to retype what we already know.
//
// The modal renders via a PORTAL to document.body — root-cause fix for a
// real bug (reported with screenshots on Plans, Company/Settings, and
// Pipeline): the trigger button lives inside <aside> in shell.tsx, which is
// `position: fixed` with NO explicit z-index. `position: fixed` always
// creates its own stacking context, so the modal's `z-50` was only ever
// being compared against siblings INSIDE that aside — never against content
// in <main>. Because <aside> has no z-index (auto) and comes FIRST in the
// DOM, any `sticky`/positioned element painted LATER in the document at the
// same implicit stack level — Pipeline's sticky table header, the plan
// cards, the company completeness bar — paints on top of aside's entire
// subtree, modal included. Dashboard/Overview "worked" only because it has
// no such competing sticky/positioned content to expose the bug. A portal
// to document.body makes the modal a true top-level sibling of everything,
// so z-50 is finally compared where it was always meant to be: against the
// whole page, not just its own accidental corner of it.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { authEnabled, browserClient } from '@/lib/supabase';
import { ContactForm, type SupportSource } from './ContactForm';

// Prompt 331 — optional controlled mode, so a caller that already renders
// its OWN trigger (the founder sidebar's Grupo 5 nav item, styled and
// positioned like every other item there) can drive this same modal/
// ContactForm without a second copy of either. Uncontrolled (both props
// omitted) is the exact, unchanged default every other call site
// (LampButton.tsx, portal/page.tsx, and this component's own prior sidebar
// use) keeps using — this widget draws its own trigger button then, same
// as always.
export function HelpSupportWidget({ source, className, open: controlledOpen, onOpenChange }: {
  source: SupportSource; className?: string; open?: boolean; onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (v: boolean) => { if (isControlled) onOpenChange?.(v); else setInternalOpen(v); };
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
      {!isControlled && (
        <button onClick={() => setOpen(true)}
          className={className ?? 'flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600'}>
          <span aria-hidden="true">◈</span> Help &amp; support
        </button>
      )}
      {open && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">Help &amp; support</h2>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700">✕</button>
            </div>
            <ContactForm source={source} defaultName={defaultName} defaultEmail={defaultEmail}
              showContext={source === 'founder_app'} />
            <Link href="/terms" target="_blank" className="mt-3 block text-xs text-gray-400 hover:underline">
              Terms &amp; Conditions
            </Link>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
