'use client';
// Prompt 106 §4 — floating "Report a problem" button, always visible,
// distinct from the existing sidebar "Help & support" link (HelpSupportWidget)
// which stays exactly as it is. Shares the same backend as that widget
// (/api/support/submit, support_tickets) — one data path, two forms: this
// one fixes category='problem' and asks for area + screenshots instead of
// asking the category again.
//
// Mounted once in the root layout (not per-shell), so it shows for both
// the founder app and the investor portal without duplicating it in two
// places. The area list is one shared set adjusted to the real top-level
// tabs across both roles, not a role-specific list — simpler, and every
// entry is real regardless of which side the visitor is on.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { authEnabled, browserClient } from '@/lib/supabase';
import { useBottomNavHeight } from '@/lib/bottom-nav-context';
import type { SupportSource } from './ContactForm';

const AREAS = ['Pipeline', 'Tasks & Agenda', 'Dashboard', 'Vault Data Room', 'Company / Profile', 'Plans & billing', 'MatchDeal', 'Account', 'Other'];

export function ReportProblemWidget() {
  // Prompt 125 Block A — was a flat `bottom-5`, which lands exactly on the
  // last item of any bottom nav ("Profile" on MatchDeal, confirmed by
  // screenshot). navHeight is 0 on any page without one (unchanged
  // position there); a small 12px gap keeps it visually separate from the
  // nav rather than touching it.
  const navHeight = useBottomNavHeight();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [area, setArea] = useState(AREAS[0]);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');
  const [source, setSource] = useState<SupportSource>('landing');

  useEffect(() => {
    if (!authEnabled) return;
    browserClient().auth.getUser().then(({ data }) => {
      const meta = data.user?.user_metadata as { full_name?: string } | undefined;
      setName(meta?.full_name ?? '');
      setEmail(data.user?.email ?? '');
    });
    fetch('/api/me', { cache: 'no-store' }).then((r) => r.json())
      .then((me) => setSource(me.role === 'investor' ? 'investor_portal' : 'founder_app'))
      .catch(() => {});
  }, []);

  const canSubmit = !!name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    && !!subject.trim() && message.trim().length >= 10 && message.length <= 5000;

  function reset() {
    setSubject(''); setMessage(''); setFiles([]); setArea(AREAS[0]); setStatus('idle'); setError('');
  }

  async function submit() {
    setStatus('sending'); setError('');
    try {
      const res = await fetch('/api/support/submit', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, email, category: 'problem', subject, message, area, source }),
      });
      const body = await res.json();
      if (body.ok === false) { setError(body.error ?? 'Something went wrong.'); setStatus('error'); return; }

      if (files.length > 0 && body.ticketId) {
        const fd = new FormData();
        fd.append('ticketId', body.ticketId);
        files.forEach((f) => fd.append('files', f));
        await fetch('/api/support/upload-attachment', { method: 'POST', body: fd }).catch(() => {});
      }
      setStatus('sent');
    } catch {
      setError('Something went wrong. Please try again.');
      setStatus('error');
    }
  }

  function onFilesPicked(picked: FileList | null) {
    if (!picked) return;
    setFiles(Array.from(picked).slice(0, 3));
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        title="Report a problem"
        style={{ bottom: navHeight > 0 ? navHeight + 12 : 20 }}
        className="fixed right-5 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-[#B00000] text-lg text-white shadow-lg transition hover:bg-[#8f0000]">
        <span aria-hidden="true">⚑</span>
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => { setOpen(false); reset(); }}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">Report a problem</h2>
              <button onClick={() => { setOpen(false); reset(); }} className="text-gray-400 hover:text-gray-700">✕</button>
            </div>

            {status === 'sent' ? (
              <div className="rounded-lg border border-gray-200 bg-white py-6 text-center">
                <h3 className="text-sm font-semibold text-gray-900">Thanks — we&apos;ll get back to you.</h3>
                <p className="mt-1 text-xs text-gray-500">We usually reply within a couple of business days.</p>
                <button onClick={() => { setOpen(false); reset(); }}
                  className="mt-3 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">Close</button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                  <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@company.com"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                </div>
                <select value={area} onChange={(e) => setArea(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  {AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
                <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" maxLength={200}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} maxLength={5000}
                  placeholder="What happened? The more detail, the faster we can fix it."
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                <div>
                  <label className="text-xs text-gray-500">Screenshots (optional, up to 3)</label>
                  <input type="file" accept="image/*" multiple onChange={(e) => onFilesPicked(e.target.files)}
                    className="mt-1 w-full text-xs text-gray-500" />
                  {files.length > 0 && <p className="mt-1 text-[11px] text-gray-400">{files.map((f) => f.name).join(', ')}</p>}
                </div>

                {!canSubmit && (name || email || subject || message) && (
                  <p className="text-xs text-amber-600">
                    Still needs: {[
                      !name.trim() && 'your name',
                      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && 'a valid email',
                      !subject.trim() && 'a subject',
                      message.trim().length < 10 && `a message of at least 10 characters (${message.trim().length}/10 so far)`,
                    ].filter(Boolean).join(', ')}.
                  </p>
                )}
                {error && <p className="text-xs text-[#B00000]">{error}</p>}
                <button onClick={submit} disabled={!canSubmit || status === 'sending'}
                  className="w-full rounded-lg bg-[#0E7490] px-3 py-2 text-sm font-medium text-white disabled:opacity-40">
                  {status === 'sending' ? 'Sending…' : 'Send report'}
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
