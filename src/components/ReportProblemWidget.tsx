'use client';
// Prompt 106 §4 — floating widget, always visible, distinct from the sidebar
// "Help & support" link (HelpSupportWidget) which stays exactly as it is.
// Shares the same backend as that widget (/api/support/submit,
// support_tickets) — one data path, several forms.
//
// Mounted once in the root layout (not per-shell), so it shows for both the
// founder app and the investor portal without duplicating it in two places.
//
// Prompt 605 §C — it used to be called "Report a problem" and that is all it
// offered. It is now a channel with two exits, so the name had to stop saying
// only problems: "Tell us", and the launcher is brand teal with a pencil
// rather than alarm red with a flag. (§C leaves the final wording to Nuno —
// "Tell us" is the shortest of the three he listed and the only one that
// reads as an invitation rather than an instruction. One string,
// TELL_US_LABEL below, if he wants another.)
//
// The problem form is unchanged, deliberately: §C says "o que já existe hoje,
// sem mudanças". The screen capture (§D) belongs to the suggestion form only.
//
// The second exit is gated (§B): the option is not shown to an org outside
// the tech master / pioneer cohorts, and /api/support/submit re-checks it —
// what follows here is display truth, never enforcement.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { authEnabled, browserClient } from '@/lib/supabase';
import { useBottomNavHeight } from '@/lib/bottom-nav-context';
import { areaFromPath } from '@/lib/support-area';
import { captureViewport, screenshotFileName } from '@/lib/screen-capture';
import type { SupportSource } from './ContactForm';

const TELL_US_LABEL = 'Tell us';
const AREAS = ['Pipeline', 'Tasks & Agenda', 'Dashboard', 'Vault Data Room', 'Company / Profile', 'Plans & billing', 'MatchDeal', 'Account', 'Other'];

// The widget must never appear in its own photograph (§D). Ids rather than a
// class, because the capture has to name these exactly — and there are TWO of
// them, which is the whole point: the open panel is rendered through
// createPortal into document.body (the project's rule for any full-viewport
// overlay), so it is NOT a DOM descendant of the launcher's wrapper. Hiding
// only the wrapper photographs the page with the panel still standing in
// front of it — exactly the thing §D asks us to remove. Caught while
// verifying the capture, not by reading the code.
const WIDGET_ROOT_ID = 'tell-us-widget';
const WIDGET_PANEL_ID = 'tell-us-panel';

type Mode = 'choose' | 'problem' | 'suggestion';

export function ReportProblemWidget() {
  // Prompt 125 Block A — was a flat `bottom-5`, which lands exactly on the
  // last item of any bottom nav ("Profile" on MatchDeal, confirmed by
  // screenshot). navHeight is 0 on any page without one (unchanged
  // position there); a small 12px gap keeps it visually separate from the
  // nav rather than touching it.
  const navHeight = useBottomNavHeight();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('problem');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [area, setArea] = useState(AREAS[0]);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');
  const [source, setSource] = useState<SupportSource>('landing');
  const [canSuggest, setCanSuggest] = useState(false);
  const [shot, setShot] = useState<{ file: File; url: string } | null>(null);
  const [shooting, setShooting] = useState(false);

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
    fetch('/api/suggestions/eligibility', { cache: 'no-store' }).then((r) => r.json())
      .then((body) => setCanSuggest(!!body.canSuggest))
      .catch(() => {});
  }, []);

  // Revoked on unmount as well as on discard: an object URL held for the life
  // of the tab keeps the whole image alive, not just a handle to it.
  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url); }, [shot]);

  const isSuggestion = mode === 'suggestion';
  const attachments = shot ? [shot.file, ...files] : files;
  const emailLooksReal = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const canSubmit = isSuggestion
    ? !!subject.trim() && message.trim().length >= 10 && message.length <= 5000
    : !!name.trim() && emailLooksReal && !!subject.trim() && message.trim().length >= 10 && message.length <= 5000;

  function reset() {
    setSubject(''); setMessage(''); setFiles([]); setArea(AREAS[0]); setStatus('idle'); setError('');
    if (shot) URL.revokeObjectURL(shot.url);
    setShot(null);
  }
  function close() { setOpen(false); reset(); setMode(canSuggest ? 'choose' : 'problem'); }

  async function submit() {
    setStatus('sending'); setError('');
    try {
      const res = await fetch('/api/support/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(isSuggestion
          // §A — `area` comes from the route, never asked. The name falls back
          // to the address's local part: the suggestion form shows no name
          // field (§C, "pede pouco") and the route requires one.
          ? {
            name: name.trim() || email.split('@')[0] || 'Someone',
            email,
            category: 'suggestion',
            subject,
            message,
            area: areaFromPath(pathname),
            source: 'feedback_widget',
          }
          : { name, email, category: 'problem', subject, message, area, source }),
      });
      const body = await res.json();
      if (body.ok === false) { setError(body.error ?? 'Something went wrong.'); setStatus('error'); return; }

      if (attachments.length > 0 && body.ticketId) {
        const fd = new FormData();
        fd.append('ticketId', body.ticketId);
        attachments.forEach((f) => fd.append('files', f));
        const up = await fetch('/api/support/upload-attachment', { method: 'POST', body: fd })
          .then((r) => r.json()).catch(() => ({ ok: false, error: 'the upload did not complete' }));
        // Was swallowed entirely (`.catch(() => {})`). The ticket is committed
        // either way, so this is not an error — but a screenshot the user
        // chose to send and that silently never arrived is exactly the thing
        // they would afterwards assume we had seen.
        if (up.ok === false) {
          setStatus('sent');
          setError(`Your message is in — but the attachment didn't upload (${up.error ?? 'unknown reason'}).`);
          return;
        }
      }
      setStatus('sent');
    } catch {
      setError('Something went wrong. Please try again.');
      setStatus('error');
    }
  }

  function onFilesPicked(picked: FileList | null) {
    if (!picked) return;
    // The upload route caps a batch at 3 files; the screenshot occupies one
    // of those slots when it exists.
    setFiles(Array.from(picked).slice(0, shot ? 2 : 3));
  }

  async function takeShot() {
    setShooting(true); setError('');
    try {
      // The whole widget goes, not just the launcher — the open panel is
      // covering the very thing the user is trying to photograph.
      const { blob, previewUrl } = await captureViewport({ hide: [`#${WIDGET_ROOT_ID}`, `#${WIDGET_PANEL_ID}`] });
      if (shot) URL.revokeObjectURL(shot.url);
      setShot({ file: new File([blob], screenshotFileName(), { type: 'image/png' }), url: previewUrl });
    } catch (e) {
      setError(`The screenshot failed: ${(e as Error).message}`);
    } finally {
      setShooting(false);
    }
  }

  function discardShot() {
    if (shot) URL.revokeObjectURL(shot.url);
    setShot(null);
  }

  const title = mode === 'choose' ? TELL_US_LABEL : isSuggestion ? 'Suggest an improvement' : 'Report a problem';

  return (
    <div id={WIDGET_ROOT_ID}>
      <button onClick={() => { setMode(canSuggest ? 'choose' : 'problem'); setOpen(true); }}
        title={TELL_US_LABEL}
        style={{ bottom: navHeight > 0 ? navHeight + 12 : 20 }}
        className="fixed right-5 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-[#0E7490] text-lg text-white shadow-lg transition hover:bg-[#0b5d73]">
        <span aria-hidden="true">✎</span>
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div id={WIDGET_PANEL_ID} className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={close}>
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">{title}</h2>
              <button onClick={close} className="text-gray-400 hover:text-gray-700">✕</button>
            </div>

            {status === 'sent' ? (
              <div className="rounded-lg border border-gray-200 bg-white py-6 text-center">
                <h3 className="text-sm font-semibold text-gray-900">
                  {isSuggestion ? 'Thanks — we read every one of these.' : "Thanks — we'll get back to you."}
                </h3>
                <p className="mt-1 text-xs text-gray-500">
                  {isSuggestion ? "You'll hear back if it turns into something." : 'We usually reply within a couple of business days.'}
                </p>
                {error && <p className="mt-2 text-xs text-amber-600">{error}</p>}
                <button onClick={close} className="mt-3 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">Close</button>
              </div>
            ) : mode === 'choose' ? (
              // Only ever reached by an eligible org: for everyone else the
              // launcher opens the problem form directly, because a menu with
              // one item is friction, not a choice.
              <div className="space-y-2">
                <button onClick={() => setMode('problem')}
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-left hover:border-[#0E7490] hover:bg-cyan-50/40">
                  <div className="text-sm font-semibold text-gray-900">Report a problem</div>
                  <div className="text-xs text-gray-500">Something is broken, wrong or confusing.</div>
                </button>
                <button onClick={() => setMode('suggestion')}
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-left hover:border-[#0E7490] hover:bg-cyan-50/40">
                  <div className="text-sm font-semibold text-gray-900">Suggest an improvement</div>
                  <div className="text-xs text-gray-500">An idea for how this should work instead.</div>
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {isSuggestion ? (
                  <p className="text-xs text-gray-500">
                    You&apos;re on <b className="font-medium text-gray-700">{areaFromPath(pathname)}</b> — we&apos;ll note that, so you don&apos;t have to.
                  </p>
                ) : (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {/* Prompt 553 — genuinely the person's own contact data,
                          so a real autoComplete token rather than "off". */}
                      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                      <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@company.com" autoComplete="email"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                    </div>
                    <select value={area} onChange={(e) => setArea(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                      {AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </>
                )}
                <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} autoComplete="off"
                  placeholder={isSuggestion ? 'In one line, what would you change?' : 'Subject'}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} maxLength={5000}
                  placeholder={isSuggestion ? 'What should happen instead, and why?' : 'What happened? The more detail, the faster we can fix it.'}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />

                {isSuggestion && (
                  <div className="rounded-lg border border-gray-200 p-3">
                    {shot ? (
                      <>
                        {/* §D.2 and §D.3 in one control: the preview IS the
                            consent. It is shown before anything is uploaded,
                            and it is the same image an operator will see. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={shot.url} alt="The screenshot that will be attached"
                          className="max-h-40 w-full rounded border border-gray-200 object-contain object-top" />
                        <p className="mt-2 text-[11px] text-gray-500">
                          This is what gets sent, exactly as you see it — including anything private that was on screen.
                        </p>
                        <div className="mt-2 flex gap-2">
                          <button onClick={discardShot}
                            className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">Discard</button>
                          <button onClick={takeShot} disabled={shooting}
                            className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40">Retake</button>
                        </div>
                      </>
                    ) : (
                      <button onClick={takeShot} disabled={shooting}
                        className="w-full rounded-lg border border-dashed border-gray-300 px-3 py-2 text-xs font-medium text-gray-600 hover:border-[#0E7490] hover:text-[#0E7490] disabled:opacity-40">
                        {shooting ? 'Taking the shot…' : 'Attach a screenshot of this page'}
                      </button>
                    )}
                  </div>
                )}

                <div>
                  <label className="text-xs text-gray-500">
                    {isSuggestion ? `Other files (optional, up to ${shot ? 2 : 3})` : 'Screenshots (optional, up to 3)'}
                  </label>
                  <input type="file" accept="image/*" multiple onChange={(e) => onFilesPicked(e.target.files)}
                    className="mt-1 w-full text-xs text-gray-500" />
                  {files.length > 0 && <p className="mt-1 text-[11px] text-gray-400">{files.map((f) => f.name).join(', ')}</p>}
                </div>

                {!canSubmit && (name || email || subject || message) && (
                  <p className="text-xs text-amber-600">
                    Still needs: {[
                      !isSuggestion && !name.trim() && 'your name',
                      !isSuggestion && !emailLooksReal && 'a valid email',
                      !subject.trim() && (isSuggestion ? 'a one-line summary' : 'a subject'),
                      message.trim().length < 10 && `a message of at least 10 characters (${message.trim().length}/10 so far)`,
                    ].filter(Boolean).join(', ')}.
                  </p>
                )}
                {error && <p className="text-xs text-[#B00000]">{error}</p>}
                <button onClick={submit} disabled={!canSubmit || status === 'sending'}
                  className="w-full rounded-lg bg-[#0E7490] px-3 py-2 text-sm font-medium text-white disabled:opacity-40">
                  {status === 'sending' ? 'Sending…' : isSuggestion ? 'Send suggestion' : 'Send report'}
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
