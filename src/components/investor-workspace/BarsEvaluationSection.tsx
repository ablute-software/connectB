'use client';
// Prompt 412 §A — "Evaluation — Sherlock framework": the structured BARS
// counterpart to ScorecardPanel's free-form criteria (a one-line copy
// distinction, not a merge — 412 §A's own instruction). Orchestrates the
// 4 axis cards, the questionnaire drawer, Open questions, and the Risk
// Register, all reading/writing through 411's own routes — this
// component never recomputes a score itself, it only ever displays what
// the server already computed (411 §D's own design intent).
import { useEffect, useState } from 'react';
import { getBarsBank } from '@/lib/bars-banks';
import { applicableQuestions, axisOfQuestionId, type AxisResult, type CrossAxisContradiction } from '@/lib/bars-scoring';
import type { BarsAxis } from '@/lib/bars-types';
import type { CompanyPhase } from '@/lib/types';
import { BarsAxisCard } from './BarsAxisCard';
import { BarsQuestionnaireDrawer, type BarsAnswerRow, type BarsFlagRow } from './BarsQuestionnaireDrawer';
import { BarsRiskRegister } from './BarsRiskRegister';
import { BarsOpenQuestions } from './BarsOpenQuestions';

const AXES: BarsAxis[] = ['team', 'market', 'product', 'technology'];
const AXIS_LABEL: Record<BarsAxis, string> = { team: 'Team', market: 'Market', product: 'Product', technology: 'Technology' };

// Flat id -> {check, axis} across all 4 banks, for the Risk Register's
// "From your {axis} assessment: {flag}" suggestion (412 §C.3) — built
// once from static content, not re-derived per render.
const ALL_RED_FLAGS = new Map<string, { check: string; axis: BarsAxis }>(
  AXES.flatMap((axis) => getBarsBank(axis).redFlags.map((f) => [f.id, { check: f.check, axis }] as const)),
);

interface BarsGetResponse {
  companyPhase: CompanyPhase | null;
  answers: BarsAnswerRow[];
  flagStates: BarsFlagRow[];
  axisStates: { axis: BarsAxis; not_material: boolean; updated_at: string }[];
  computed: Partial<Record<BarsAxis, AxisResult>>;
  contradictions: CrossAxisContradiction[];
}
interface EvaluationSnapshot { id: string; inputs: Record<string, unknown>; outputs: Record<string, unknown>; created_at: string }

export function BarsEvaluationSection({ orgId }: { orgId: string }) {
  const [data, setData] = useState<BarsGetResponse | null>(null);
  const [openAxis, setOpenAxis] = useState<BarsAxis | null>(null);
  const [snapshots, setSnapshots] = useState<EvaluationSnapshot[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function load() {
    fetch(`/api/portal/bars?orgId=${encodeURIComponent(orgId)}`).then((r) => r.json()).then((d) => setData(d)).catch(() => {});
  }
  function loadSnapshots() {
    fetch(`/api/portal/evaluation-snapshots?orgId=${encodeURIComponent(orgId)}&kind=bars`).then((r) => r.json())
      .then((d) => setSnapshots(d.snapshots ?? [])).catch(() => setSnapshots([]));
  }
  useEffect(() => { load(); loadSnapshots(); }, [orgId]);

  async function toggleNotMaterial(axis: BarsAxis, notMaterial: boolean) {
    await fetch('/api/portal/bars', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId, kind: 'axis_state', axis, notMaterial }),
    });
    load();
  }

  async function saveSnapshot() {
    if (!data) return;
    setSaving(true);
    try {
      const outputs = Object.fromEntries(AXES.map((axis) => [axis, data.computed[axis] ? {
        score: data.computed[axis]!.score, coverage: data.computed[axis]!.coverage,
        confidenceBand: data.computed[axis]!.confidenceBand, notMaterial: data.computed[axis]!.notMaterial,
      } : null]));
      const res = await fetch('/api/portal/evaluation-snapshots', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          orgId, kind: 'bars',
          inputs: { answers: data.answers, flagStates: data.flagStates, axisStates: data.axisStates },
          outputs,
        }),
      });
      if (res.ok) { setSavedAt(Date.now()); loadSnapshots(); }
    } finally { setSaving(false); }
  }

  if (!data) return <p className="text-xs text-gray-400">Loading Sherlock framework…</p>;

  const confirmedFlags = data.flagStates
    .filter((f) => f.state === 'confirmed')
    .map((f) => {
      const meta = ALL_RED_FLAGS.get(f.flag_id);
      return meta ? { flagId: f.flag_id, check: meta.check, axis: meta.axis } : null;
    })
    .filter((f): f is { flagId: string; check: string; axis: BarsAxis } => f !== null);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Evaluation — Sherlock framework</h2>
          <p className="text-[11px] text-gray-400">Structured, evidence-anchored — separate from &quot;Your own criteria&quot; above. Private to you, never shown to the startup.</p>
        </div>
        <button onClick={() => void saveSnapshot()} disabled={saving}
          className="shrink-0 rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">
          {saving ? 'Saving…' : savedAt && Date.now() - savedAt < 2000 ? 'Saved ✓' : 'Save snapshot'}
        </button>
      </div>

      {/* Single column — this section mounts inside a fixed 320px sidebar
          (page.tsx's lg:grid-cols-[320px_1fr_260px]); Tailwind's `sm:`
          breakpoint reacts to VIEWPORT width, not this column's own
          width, so a multi-column grid here would cram 2 cards into
          ~150px each on any normal desktop viewport rather than actually
          responding to the space available. */}
      <div className="mt-3 grid grid-cols-1 gap-2">
        {AXES.map((axis) => (
          <BarsAxisCard key={axis} axis={axis} label={AXIS_LABEL[axis]} result={data.computed[axis] ?? null}
            applicableAtStage={applicableQuestions(getBarsBank(axis), data.companyPhase ?? 'concept_idea').length}
            onOpen={() => setOpenAxis(axis)}
            onToggleNotMaterial={axis === 'technology' ? (v) => void toggleNotMaterial(axis, v) : undefined} />
        ))}
      </div>

      <div className="mt-3 border-t border-gray-100 pt-3">
        <BarsOpenQuestions contradictions={data.contradictions} onNavigate={setOpenAxis} />
      </div>

      <div className="mt-3 border-t border-gray-100 pt-3">
        <BarsRiskRegister orgId={orgId} confirmedFlags={confirmedFlags} />
      </div>

      {snapshots.length > 0 && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <div className="text-xs font-medium text-gray-500">History</div>
          <ul className="mt-1.5 space-y-1">
            {snapshots.map((s) => {
              const outputs = s.outputs as Record<BarsAxis, { score: number | null; notMaterial: boolean } | null>;
              const summary = AXES.map((axis) => {
                const o = outputs[axis];
                if (!o || o.notMaterial) return `${AXIS_LABEL[axis]} —`;
                return `${AXIS_LABEL[axis]} ${o.score != null ? o.score.toFixed(1) : '—'}`;
              }).join(' · ');
              return (
                <li key={s.id} className="text-xs text-gray-600">
                  {new Date(s.created_at).toLocaleDateString()} — {summary}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {openAxis && (
        <BarsQuestionnaireDrawer orgId={orgId} axis={openAxis} axisLabel={AXIS_LABEL[openAxis]} companyPhase={data.companyPhase}
          answers={data.answers} flagStates={data.flagStates} onClose={() => setOpenAxis(null)} onMutated={load} />
      )}
    </div>
  );
}
