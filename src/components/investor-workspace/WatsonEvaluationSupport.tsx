'use client';
// Prompt 349 — Chamber 1 (private, ephemeral-to-the-founder) + the doorway
// into Chamber 2 (explicit, item-by-item share). "Get Watson's opinion"
// never runs automatically — the investor asks for it. Every insight shown
// here is AI-generated (T&C clause 9): marked as such, and never persisted
// where the founder can see it unless the investor explicitly shares that
// ONE item after seeing its exact text.
//
// Prompt 394 §4 — renamed from "Get Watson support"; results now open in
// WatsonInsightsModal (full screen, not this cramped widget) and readings
// persist (watson_evaluation_readings, §4.4) so a second click can offer
// "open the last one, or ask for a new opinion?" instead of always
// re-generating. This component is now just the button + that small
// intermediate choice — all the reading/history/share UI lives in the
// modal.
import { useEffect, useState } from 'react';
import { WatsonInsightsModal } from './WatsonInsightsModal';

interface Insight { kind: 'reading' | 'threshold_suggestion' | 'alert_reason'; text: string }
interface Reading { id: string; insights: Insight[]; created_at: string }

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function WatsonEvaluationSupport({ orgId }: { orgId: string }) {
  // undefined = not fetched yet, null = fetched, no prior reading.
  const [lastReading, setLastReading] = useState<Reading | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [asking, setAsking] = useState(false);
  const [modal, setModal] = useState<{ insights: Insight[]; readAt: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/portal/watson/evaluation-support/history?orgId=${encodeURIComponent(orgId)}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setLastReading(d.ok && d.readings?.[0] ? d.readings[0] : null); })
      .catch(() => { if (!cancelled) setLastReading(null); });
    return () => { cancelled = true; };
  }, [orgId]);

  async function requestNew() {
    setLoading(true); setError(''); setAsking(false);
    try {
      const res = await fetch('/api/portal/watson/evaluation-support', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orgId }),
      });
      const body = await res.json();
      if (!body.ok) { setError(body.error ?? 'Watson support is not available right now.'); return; }
      const insights: Insight[] = body.insights ?? [];
      const readAt = new Date().toISOString();
      setModal({ insights, readAt });
      setLastReading({ id: 'fresh', insights, created_at: readAt });
    } catch {
      setError('Watson support is not available right now.');
    } finally { setLoading(false); }
  }

  function handleClick() {
    if (loading || lastReading === undefined) return;
    if (lastReading === null) { void requestNew(); return; }
    setAsking(true);
  }

  return (
    <div className="rounded-lg border border-cyan-100 bg-cyan-50/40 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[#0E7490]">Watson</span>
        <button onClick={handleClick} disabled={loading || lastReading === undefined}
          className="flex items-center gap-1.5 rounded-lg border border-cyan-300 bg-white px-2.5 py-1 text-xs font-medium text-[#0E7490] hover:bg-cyan-50 disabled:opacity-50">
          {/* §4.3 — a small dot marks "there's at least one earlier reading for this startup" */}
          {lastReading && <span className="h-1.5 w-1.5 rounded-full bg-[#0E7490]" aria-hidden />}
          {loading ? 'Thinking…' : "Get Watson's opinion"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {asking && lastReading && (
        <div className="mt-2 rounded-lg border border-cyan-200 bg-white p-2.5 text-xs">
          <p className="text-gray-600">Last read {formatWhen(lastReading.created_at)}.</p>
          <div className="mt-2 flex gap-2">
            <button onClick={() => { setModal({ insights: lastReading.insights, readAt: lastReading.created_at }); setAsking(false); }}
              className="rounded-lg border border-gray-300 px-2.5 py-1 font-medium text-gray-700 hover:bg-gray-50">
              Open that one
            </button>
            <button onClick={() => void requestNew()} disabled={loading}
              className="rounded-lg bg-[#0E7490] px-2.5 py-1 font-medium text-white disabled:opacity-50">
              {loading ? 'Thinking…' : 'Ask for a new opinion'}
            </button>
            <button onClick={() => setAsking(false)} className="text-gray-400 hover:underline">Cancel</button>
          </div>
        </div>
      )}

      {modal && (
        <WatsonInsightsModal orgId={orgId} insights={modal.insights} readAt={modal.readAt} onClose={() => setModal(null)} />
      )}
    </div>
  );
}
