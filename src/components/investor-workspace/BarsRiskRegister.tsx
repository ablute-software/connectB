'use client';
// Prompt 412 §C — the Risk Register: 14 fixed categories, "Not assessed"
// explicit and gray (never green — unknown != low, 411 §B.4's own words),
// each row expandable to probability/impact/mitigation/residual/
// thesis-breaking/evidence/note. Confirmed BARS red flags on a
// same-named axis (team/market/product/technology — 4 of the 14) surface
// as SUGGESTED evidence text only, never auto-filled into evidence_refs.
import { useEffect, useState } from 'react';
import { RISK_CATEGORIES, RISK_LEVELS, type RiskCategory, type RiskLevel, type BarsAxis } from '@/lib/bars-types';
import type { EvidenceRef } from './BarsEvidenceRail';

const CATEGORY_LABEL: Record<RiskCategory, string> = {
  technology: 'Technology', product: 'Product', market: 'Market', adoption: 'Adoption',
  commercial: 'Commercial', financial: 'Financial', financing: 'Financing', team: 'Team',
  governance: 'Governance', legal_ip: 'Legal / IP', regulatory: 'Regulatory', competitive: 'Competitive',
  execution: 'Execution', exit_liquidity: 'Exit / Liquidity',
};
const LEVEL_LABEL: Record<RiskLevel, string> = { low: 'Low', medium: 'Medium', high: 'High' };
const AXIS_CATEGORIES: RiskCategory[] = ['team', 'market', 'product', 'technology'];

interface RiskRow {
  category: RiskCategory; probability: RiskLevel | null; impact: RiskLevel | null; assessed: boolean;
  mitigation: string | null; residual: RiskLevel | null; thesis_breaking: boolean;
  evidence_refs: EvidenceRef[]; note: string | null; updated_at: string | null;
}

function RiskRowEditor({ orgId, row, suggestedFlags, onSaved }: {
  orgId: string; row: RiskRow; suggestedFlags: { flagId: string; check: string }[]; onSaved: (row: RiskRow) => void;
}) {
  const [probability, setProbability] = useState<RiskLevel | null>(row.probability);
  const [impact, setImpact] = useState<RiskLevel | null>(row.impact);
  const [residual, setResidual] = useState<RiskLevel | null>(row.residual);
  const [mitigation, setMitigation] = useState(row.mitigation ?? '');
  const [note, setNote] = useState(row.note ?? '');
  const [thesisBreaking, setThesisBreaking] = useState(row.thesis_breaking);
  const [evidenceRefs, setEvidenceRefs] = useState<EvidenceRef[]>(row.evidence_refs ?? []);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/portal/case-risks', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          orgId, category: row.category, probability, impact, residual, mitigation: mitigation || null,
          note: note || null, thesisBreaking, assessed: true, evidenceRefs,
        }),
      });
      if (res.ok) {
        setSavedAt(Date.now());
        onSaved({ ...row, probability, impact, residual, mitigation: mitigation || null, note: note || null, thesis_breaking: thesisBreaking, assessed: true, evidence_refs: evidenceRefs });
      }
    } finally { setSaving(false); }
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-gray-100 bg-gray-50/60 p-2.5">
      <div className="grid grid-cols-3 gap-2">
        {(['probability', 'impact', 'residual'] as const).map((field) => {
          const value = field === 'probability' ? probability : field === 'impact' ? impact : residual;
          const setValue = field === 'probability' ? setProbability : field === 'impact' ? setImpact : setResidual;
          return (
            <div key={field}>
              <label className="text-[10px] uppercase tracking-wide text-gray-400">{field}</label>
              <div className="mt-0.5 flex gap-1">
                {RISK_LEVELS.map((l) => (
                  <button key={l} onClick={() => setValue(value === l ? null : l)}
                    className={`flex-1 rounded px-1 py-0.5 text-[11px] ${value === l ? 'bg-[#0E7490] text-white' : 'bg-white text-gray-500 hover:bg-gray-100'} border border-gray-200`}>
                    {LEVEL_LABEL[l]}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-wide text-gray-400">Mitigation</label>
        <input value={mitigation} onChange={(e) => setMitigation(e.target.value)} placeholder="Short mitigation note…"
          className="mt-0.5 w-full rounded border border-gray-200 px-2 py-1 text-xs" />
      </div>

      <label className="flex items-center gap-1.5 text-xs text-gray-600">
        <input type="checkbox" checked={thesisBreaking} onChange={(e) => setThesisBreaking(e.target.checked)} className="accent-[#B00000]" />
        ★ Thesis-breaking
      </label>

      {suggestedFlags.length > 0 && (
        <div className="text-[11px] text-gray-500">
          {suggestedFlags.map((f) => (
            <button key={f.flagId} type="button"
              onClick={() => setEvidenceRefs((prev) => prev.some((r) => r.text === f.check) ? prev : [...prev, { kind: 'investor_note', text: f.check }])}
              className="mr-1 mb-1 inline-block rounded-full border border-dashed border-gray-300 px-2 py-0.5 hover:border-gray-400 hover:text-gray-700">
              From your {CATEGORY_LABEL[row.category]} assessment: {f.check}
            </button>
          ))}
        </div>
      )}

      {evidenceRefs.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {evidenceRefs.map((r, i) => (
            <span key={i} className="flex items-center gap-1 rounded-full border border-[#0E7490] bg-[#0E7490]/10 px-2 py-0.5 text-[11px] text-[#0E7490]">
              <span className="max-w-[200px] truncate">{r.text ?? r.kind}</span>
              <button type="button" onClick={() => setEvidenceRefs((prev) => prev.filter((_, idx) => idx !== i))} className="text-[#0E7490]/70 hover:text-[#0E7490]">✕</button>
            </span>
          ))}
        </div>
      )}

      <div>
        <label className="text-[10px] uppercase tracking-wide text-gray-400">Note</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional…"
          className="mt-0.5 w-full rounded border border-gray-200 px-2 py-1 text-xs" />
      </div>

      <div className="flex items-center gap-2">
        <button onClick={() => void save()} disabled={saving}
          className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">
          {saving ? 'Saving…' : savedAt && Date.now() - savedAt < 2000 ? 'Saved ✓' : 'Save'}
        </button>
      </div>
    </div>
  );
}

export function BarsRiskRegister({ orgId, confirmedFlags }: { orgId: string; confirmedFlags: { flagId: string; check: string; axis: BarsAxis }[] }) {
  const [risks, setRisks] = useState<RiskRow[] | null>(null);
  const [openCategory, setOpenCategory] = useState<RiskCategory | null>(null);

  useEffect(() => {
    fetch(`/api/portal/case-risks?orgId=${encodeURIComponent(orgId)}`).then((r) => r.json())
      .then((d) => setRisks(d.risks ?? [])).catch(() => setRisks([]));
  }, [orgId]);

  if (!risks) return <p className="text-xs text-gray-400">Loading risk register…</p>;

  const assessedCount = risks.filter((r) => r.assessed).length;
  const thesisBreakingCount = risks.filter((r) => r.assessed && r.thesis_breaking).length;
  const notAssessedCount = risks.length - assessedCount;

  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-500">Risk register</h3>
        <p className="text-[11px] text-gray-400">{assessedCount} of {risks.length} assessed · {thesisBreakingCount} thesis-breaking · {notAssessedCount} not assessed</p>
      </div>

      <div className="mt-2 space-y-1">
        {risks.map((row) => {
          const suggestedFlags = AXIS_CATEGORIES.includes(row.category)
            ? confirmedFlags.filter((f) => f.axis === row.category).map((f) => ({ flagId: f.flagId, check: f.check }))
            : [];
          const isOpen = openCategory === row.category;
          return (
            <div key={row.category}>
              <button onClick={() => setOpenCategory(isOpen ? null : row.category)}
                className="flex w-full items-center justify-between rounded px-1.5 py-1 text-left text-xs hover:bg-gray-50">
                <span className="text-gray-700">{CATEGORY_LABEL[row.category]}</span>
                {row.assessed ? (
                  <span className="flex items-center gap-1">
                    {row.thesis_breaking && <span className="text-[#B00000]" title="Thesis-breaking">★</span>}
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">
                      {row.probability ? LEVEL_LABEL[row.probability] : '—'} / {row.impact ? LEVEL_LABEL[row.impact] : '—'}
                    </span>
                  </span>
                ) : (
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-400">Not assessed</span>
                )}
              </button>
              {isOpen && <RiskRowEditor orgId={orgId} row={row} suggestedFlags={suggestedFlags}
                onSaved={(updated) => setRisks((prev) => prev!.map((r) => r.category === updated.category ? updated : r))} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
