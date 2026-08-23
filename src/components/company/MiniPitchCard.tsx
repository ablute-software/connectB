'use client';
// Prompt 334 — the MatchDeal mini-pitch: 5 auto-generated slides synthesized
// from the claims registry + profile fields. This card is the founder's own
// console for it: gate status (what's missing, with a link to fix it —
// never an opaque "not eligible"), a preview (with the evidence-class
// reasoning behind each Proof/Why-now/Team claim, since the founder is
// allowed to see WHY a claim was picked — an investor never is, see
// MiniPitchSlides in DossierOverviewSections.tsx), and Generate/Activate.
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';
import { authEnabled } from '@/lib/supabase';

interface GateField { key: string; label: string; href: string }
interface Gate { eligible: boolean; missing: GateField[] }
interface Slide { kind: 'hook' | 'whyNow' | 'proof' | 'team' | 'ask'; title?: string; body: string; claimIds?: string[] }
interface Pitch { slides: Slide[]; generatedAt: string; activatedAt: string | null; stale: boolean }

const SLIDE_LABEL: Record<Slide['kind'], string> = {
  hook: 'Hook', whyNow: 'Why now', proof: 'Proof', team: 'Team', ask: 'The ask',
};

const ACTIVATION_COPY = 'A mini-pitch is generated automatically from your company profile and the Vault documents '
  + "you've marked as shareable at the lightest level — it's what an investor sees first. The more information you "
  + 'provide, the better your chances of the perfect match, and the smoother the process continues once an investor '
  + 'shows interest.';

export function MiniPitchCard({ canEdit }: { canEdit: boolean }) {
  const [gate, setGate] = useState<Gate | null>(null);
  const [pitch, setPitch] = useState<Pitch | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showActivationCopy, setShowActivationCopy] = useState(false);

  function load() {
    // Demo mode has no real org/claims for the server route to read from —
    // same "nothing meaningful to compute" case as BadgesCard's own guard,
    // except here there's no reasonable empty state to show, so the whole
    // card stays hidden rather than displaying a confusing always-empty gate.
    if (!authEnabled) return;
    fetch('/api/mini-pitch').then((r) => r.json()).then((b) => {
      if (!b.ok) return;
      setGate(b.gate);
      setPitch(b.pitch);
    }).catch(() => {});
  }
  useEffect(load, []);

  function generate(activate: boolean) {
    setBusy(true); setError('');
    fetch('/api/mini-pitch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ activate }) })
      .then((r) => r.json()).then((b) => {
        if (!b.ok) { setError(b.error ?? 'Could not generate the mini-pitch.'); return; }
        if (b.configured === false) { setError(b.message); return; }
        setPitch(b.pitch);
        setShowActivationCopy(false);
      }).finally(() => setBusy(false));
  }

  if (!canEdit && !pitch?.activatedAt) return null;
  if (!gate) return null;

  return (
    <Card title="MatchDeal mini-pitch">
      {!gate.eligible ? (
        <div>
          <p className="text-sm text-gray-500">A few things are missing before a mini-pitch can be generated:</p>
          <ul className="mt-1.5 space-y-1">
            {gate.missing.map((m) => (
              <li key={m.key} className="text-sm">
                <a href={m.href} className="text-[#0E7490] hover:underline">{m.label}</a>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="space-y-3">
          {pitch?.stale && (
            <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700">
              Your profile or claims changed since this was last generated — regenerate to keep it current.
            </p>
          )}
          {pitch ? (
            <ul className="space-y-2">
              {pitch.slides.map((s, i) => (
                <li key={i} className="rounded-lg border border-gray-100 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-gray-500">{SLIDE_LABEL[s.kind]}</span>
                    {s.claimIds && s.claimIds.length > 0 && (
                      <span className="text-[10px] text-gray-400">from {s.claimIds.length} claim{s.claimIds.length === 1 ? '' : 's'}</span>
                    )}
                  </div>
                  {s.title && <p className="mt-0.5 text-sm font-medium text-gray-800">{s.title}</p>}
                  <p className="mt-0.5 text-sm text-gray-700">{s.body}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-400">No mini-pitch generated yet.</p>
          )}

          {error && <p className="text-xs font-medium text-[#B00000]">{error}</p>}

          {canEdit && (
            <div className="space-y-2">
              {showActivationCopy && !pitch?.activatedAt && (
                <p className="rounded-lg bg-gray-50 p-2.5 text-xs text-gray-600">{ACTIVATION_COPY}</p>
              )}
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => generate(false)} disabled={busy}
                  className="rounded-full border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 disabled:opacity-40">
                  {pitch ? 'Regenerate preview' : 'Preview mini-pitch'}
                </button>
                {!pitch?.activatedAt && (
                  showActivationCopy ? (
                    <button onClick={() => generate(true)} disabled={busy || !pitch}
                      className="rounded-full bg-[#0E7490] px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300">
                      Activate for investors
                    </button>
                  ) : (
                    <button onClick={() => setShowActivationCopy(true)} disabled={busy || !pitch}
                      className="rounded-full bg-[#0E7490] px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300">
                      Activate for investors
                    </button>
                  )
                )}
              </div>
              {pitch?.activatedAt && (
                <p className="text-[11px] text-emerald-700">Live — investors who reach Level 1 with you see this.</p>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
