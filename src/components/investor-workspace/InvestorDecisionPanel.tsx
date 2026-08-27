'use client';
// Prompt 408 §C — "Your decision": the investor's own private record for
// this one startup. Decision changes are append-only (investor_case_decisions,
// migration 0259) — "Update decision" always posts a NEW row, never edits
// the old one; the API returns the latest as "current" and the API layer
// (not this component) decides what counts as current. Micro-predictions
// are captured only in this wave — resolution/calibration is a future
// wave's job (the table already has the columns for it).
//
// Same permanent private-judgment framing as Berkus/Scenarios & returns:
// this is never shown to the startup, stated in the block itself, not
// just in a comment.
import { useEffect, useState } from 'react';

type Decision = 'invest' | 'pass' | 'watch';
interface DecisionEntry { id: string; decision: Decision; thesis: string; premortem: string | null; created_at: string }
interface PredictionEntry { id: string; prediction: string; horizon_months: number; created_at: string; resolved_at: string | null; outcome: 'true' | 'false' | null }

const DECISION_LABEL: Record<Decision, string> = { invest: 'Invest', pass: 'Pass', watch: 'Watch' };
const DECISION_STYLE: Record<Decision, string> = {
  invest: 'bg-emerald-50 text-emerald-700', pass: 'bg-red-50 text-[#B00000]', watch: 'bg-amber-50 text-amber-700',
};
// Prompt 408 §C.2 — verbatim preset copy.
const PREDICTION_PRESETS = [
  { text: 'Closes this round within 9 months', months: 9 },
  { text: 'Reaches next milestone on roadmap within 6 months', months: 6 },
];

export function InvestorDecisionPanel({ orgId }: { orgId: string }) {
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<DecisionEntry | null>(null);
  const [editing, setEditing] = useState(false);
  const [decision, setDecision] = useState<Decision | ''>('');
  const [thesis, setThesis] = useState('');
  const [premortemOpen, setPremortemOpen] = useState(false);
  const [premortem, setPremortem] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [predictions, setPredictions] = useState<PredictionEntry[]>([]);
  const [customPrediction, setCustomPrediction] = useState('');
  const [customHorizon, setCustomHorizon] = useState('6');

  function load() {
    setLoading(true);
    Promise.all([
      fetch(`/api/portal/case-decision?orgId=${encodeURIComponent(orgId)}`).then((r) => r.json()),
      fetch(`/api/portal/case-predictions?orgId=${encodeURIComponent(orgId)}`).then((r) => r.json()),
    ]).then(([d, p]) => {
      setCurrent(d.current ?? null);
      setEditing(!d.current);
      setPredictions(p.predictions ?? []);
    }).catch(() => { setCurrent(null); setPredictions([]); }).finally(() => setLoading(false));
  }
  useEffect(load, [orgId]);

  async function saveDecision() {
    if (!decision || !thesis.trim()) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch('/api/portal/case-decision', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId, decision, thesis: thesis.trim(), premortem: premortemOpen ? premortem.trim() : undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) { setError(body.error ?? 'Could not save — try again.'); return; }
      setDecision(''); setThesis(''); setPremortem(''); setPremortemOpen(false);
      load();
    } finally { setSaving(false); }
  }

  async function addPrediction(text: string, months: number) {
    if (!text.trim() || !months) return;
    await fetch('/api/portal/case-predictions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId, prediction: text.trim(), horizonMonths: months }),
    }).catch(() => {});
    load();
  }

  const openPredictions = predictions.filter((p) => !p.resolved_at);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="text-xs font-semibold text-gray-700">Your decision</div>
      <p className="mt-0.5 text-[11px] text-gray-400">Your own private record — never visible to this startup.</p>

      {loading ? (
        <p className="mt-2 text-xs text-gray-400">Loading…</p>
      ) : (
        <>
          {current && !editing && (
            <div className="mt-2 rounded-lg bg-gray-50 p-2">
              <div className="flex items-center justify-between">
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${DECISION_STYLE[current.decision]}`}>{DECISION_LABEL[current.decision]}</span>
                <span className="text-[11px] text-gray-400">{new Date(current.created_at).toLocaleDateString()}</span>
              </div>
              <p className="mt-1 text-xs italic text-gray-600">&ldquo;{current.thesis}&rdquo;</p>
              {current.premortem && <p className="mt-1 text-[11px] text-gray-500">Pre-mortem: {current.premortem}</p>}
              <button onClick={() => setEditing(true)} className="mt-1.5 text-xs font-medium text-[#0E7490] hover:underline">Update decision</button>
            </div>
          )}

          {editing && (
            <div className="mt-2 space-y-1.5">
              {error && <p className="text-[11px] text-[#B00000]">{error}</p>}
              <div className="flex gap-1.5">
                {(['invest', 'pass', 'watch'] as const).map((d) => (
                  <button key={d} onClick={() => setDecision(d)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${decision === d ? 'bg-[#0E7490] text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                    {DECISION_LABEL[d]}
                  </button>
                ))}
              </div>
              <textarea value={thesis} onChange={(e) => setThesis(e.target.value)} rows={2}
                placeholder="What must be true for this to work?" className="w-full rounded border border-gray-300 p-1.5 text-xs" />
              <button onClick={() => setPremortemOpen((v) => !v)} className="text-[11px] text-gray-400 hover:underline">
                {premortemOpen ? 'Hide' : 'Add'} pre-mortem (optional)
              </button>
              {premortemOpen && (
                <textarea value={premortem} onChange={(e) => setPremortem(e.target.value)} rows={2}
                  placeholder="What would make this fail?" className="w-full rounded border border-gray-300 p-1.5 text-xs" />
              )}
              <div className="flex items-center gap-2">
                <button onClick={() => void saveDecision()} disabled={saving || !decision || !thesis.trim()}
                  className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">
                  {saving ? 'Saving…' : 'Save decision'}
                </button>
                {current && <button onClick={() => setEditing(false)} className="text-xs text-gray-400 hover:underline">Cancel</button>}
              </div>
            </div>
          )}

          <div className="mt-3 border-t border-gray-100 pt-2">
            <div className="text-[11px] font-medium text-gray-500">Micro-predictions</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {PREDICTION_PRESETS.map((p) => (
                <button key={p.text} onClick={() => void addPrediction(p.text, p.months)}
                  className="rounded-full border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:border-[#0E7490]">
                  + {p.text} ({p.months}mo)
                </button>
              ))}
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <input value={customPrediction} onChange={(e) => setCustomPrediction(e.target.value)} placeholder="Custom prediction…"
                className="min-w-0 flex-1 rounded border border-gray-300 px-1.5 py-1 text-[11px]" />
              <input type="number" value={customHorizon} onChange={(e) => setCustomHorizon(e.target.value)}
                className="w-12 rounded border border-gray-300 px-1.5 py-1 text-[11px]" />
              <span className="text-[11px] text-gray-400">mo</span>
              <button onClick={() => { void addPrediction(customPrediction, Number(customHorizon) || 0); setCustomPrediction(''); }}
                disabled={!customPrediction.trim()} className="text-[11px] font-medium text-[#0E7490] hover:underline disabled:opacity-40">
                Add
              </button>
            </div>
            {openPredictions.length > 0 && (
              <ul className="mt-1.5 space-y-1">
                {openPredictions.map((p) => (
                  <li key={p.id} className="text-[11px] text-gray-600">
                    {p.prediction} <span className="text-gray-400">— {p.horizon_months}mo, {new Date(p.created_at).toLocaleDateString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
