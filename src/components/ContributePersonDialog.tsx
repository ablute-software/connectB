'use client';

// Prompt 512 — "+ Add a person" on an investor firm's team, with the link
// that proves the role. Sherlock checks the link; if it holds up, the person
// joins the shared catalog immediately and the founder earns a point per
// validated field.
//
// Sherlock golden rule applied to the copy: this must READ as small. Three
// fields, one of them optional, and the dialog leads with what Sherlock will
// do rather than with what the founder still has to supply.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// CLAUDE.md, non-negotiable: a full-viewport overlay is rendered through a
// portal to document.body, never inline. Any ancestor carrying transform /
// filter / backdrop-filter becomes the containing block for a fixed-position
// descendant and silently collapses the overlay to that ancestor's box — the
// exact failure the shared WorkspaceHeader's backdrop-blur already caused
// once (800px overlay reduced to 53px), with no error and no failing test.
function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md">{children}</div>
    </div>,
    document.body,
  );
}

interface Rejection { field: 'name' | 'title'; reason: string }

interface ContributeResult {
  ok: boolean;
  accepted?: boolean;
  pointsAwarded?: number;
  balance?: number;
  validated?: { name: string | null; title: string | null; originalTitle: string | null; detectedLanguage: string | null };
  rejections?: Rejection[];
  reasoning?: string;
  error?: string;
}

export function ContributePersonDialog({
  entityId, entityName, open, onClose, onContributed,
}: {
  entityId: string;
  entityName: string;
  open: boolean;
  onClose: () => void;
  onContributed?: () => void;
}) {
  const [fullName, setFullName] = useState('');
  const [title, setTitle] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ContributeResult | null>(null);

  useEffect(() => {
    if (!open) { setFullName(''); setTitle(''); setSourceUrl(''); setResult(null); setBusy(false); }
  }, [open]);

  if (!open) return null;

  // The congratulation popup. Same mechanic as MatchDealDeck's match
  // overlay (state + tap to dismiss); different copy. Deliberately NOT
  // auto-dismissed on a timer like that one: this carries a number the
  // founder earned and a running wallet total, which is worth reading at
  // their own pace rather than snatching away after 3.6s.
  if (result?.ok && result.accepted) {
    return (
      <Overlay onClose={() => { onContributed?.(); onClose(); }}>
        <div className="rounded-3xl bg-white p-6 text-center shadow-2xl">
          <div className="text-4xl">🎉</div>
          <h3 className="mt-3 text-lg font-bold text-gray-900">Thank you — that checked out.</h3>
          <p className="mt-1 text-sm text-gray-600">
            Sherlock confirmed {result.validated?.name ?? fullName}
            {result.validated?.title ? <> as <span className="font-medium">{result.validated.title}</span></> : null}
            {' '}at {entityName}. Every founder on Sherlock sees this now.
          </p>
          {result.validated?.originalTitle
            && result.validated.originalTitle !== result.validated.title && (
            <p className="mt-1 text-xs text-gray-400">
              Translated from “{result.validated.originalTitle}”
              {result.validated.detectedLanguage ? ` (${result.validated.detectedLanguage})` : ''}.
            </p>
          )}
          <div className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3">
            <div className="text-2xl font-bold text-emerald-700">
              +{result.pointsAwarded} {result.pointsAwarded === 1 ? 'point' : 'points'}
            </div>
            <div className="mt-0.5 text-xs text-emerald-700/80">
              {result.balance} in your wallet
            </div>
          </div>
          {/* The rewards programme itself is explicitly out of scope ("no
              futuro"), so this says what is true today and promises nothing. */}
          <p className="mt-3 text-[11px] text-gray-400">Points accumulate on your account.</p>
          <button
            onClick={() => { onContributed?.(); onClose(); }}
            className="mt-4 w-full rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800"
          >
            Done
          </button>
        </div>
      </Overlay>
    );
  }

  const rejections = result?.rejections ?? [];

  return (
    <Overlay onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setResult(null);
          try {
            const res = await fetch(`/api/entities/${entityId}/contribute-person`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ fullName, title: title || undefined, sourceUrl }),
            });
            setResult(await res.json() as ContributeResult);
          } catch {
            setResult({ ok: false, error: 'That could not be checked right now. Try again in a moment.' });
          } finally {
            setBusy(false);
          }
        }}
        className="rounded-3xl bg-white p-6 shadow-2xl"
      >
        <h3 className="text-lg font-bold text-gray-900">Add someone from {entityName}</h3>
        <p className="mt-1 text-sm text-gray-500">
          Give Sherlock a link that shows their role — the firm’s own team page works best.
          Sherlock reads it and confirms the details, so you don’t have to.
        </p>

        <label className="mt-4 block text-xs font-medium text-gray-600">
          Name
          <input
            value={fullName} onChange={(e) => setFullName(e.target.value)} required autoFocus
            placeholder="Ana Silva"
            className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
          />
        </label>

        <label className="mt-3 block text-xs font-medium text-gray-600">
          Role <span className="font-normal text-gray-400">— optional</span>
          <input
            value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Partner"
            className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
          />
        </label>

        <label className="mt-3 block text-xs font-medium text-gray-600">
          Link showing their role
          <input
            value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} required type="url"
            placeholder="https://clave.capital/equipo/"
            className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
          />
        </label>

        {result && !result.accepted && (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-900">
            {result.error ? (
              <p>{result.error}</p>
            ) : (
              <>
                <p className="font-semibold">Sherlock couldn’t confirm that from this link.</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {rejections.map((r, i) => <li key={i}>{r.reason}</li>)}
                </ul>
                {result.reasoning && <p className="mt-1.5 text-amber-800/80">{result.reasoning}</p>}
                {/* Says plainly that nothing was stored, so the founder is
                    not left wondering whether a half-accepted record exists. */}
                <p className="mt-1.5 text-amber-800/80">Nothing was saved. Try the firm’s own team page.</p>
              </>
            )}
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose}
            className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button type="submit" disabled={busy || !fullName.trim() || !sourceUrl.trim()}
            className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-40">
            {busy ? 'Sherlock is checking…' : 'Check and add'}
          </button>
        </div>
      </form>
    </Overlay>
  );
}
