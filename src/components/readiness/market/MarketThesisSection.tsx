'use client';
// Prompt 444 §F — Market Thesis: what the platform actually knows about
// the company, replacing sectors.join(', ') as the ground truth every
// market search reads from (the confirmed bug that proposed Cleanwatts/
// Agroop as competitors for a health biochip). Always visible above
// everything else in this tab, and never gated by MarketDataPanel's own
// "basics" gate below it — filling this in is often itself the missing
// basic, so it can't sit behind the same gate it helps unlock.
//
// Hypothesis generation is verify-then-promote: generate/route.ts only
// ever proposes candidates, never writes org_market_hypotheses directly —
// this component's own confirmCandidates() is the one call that does.
import { useEffect, useState } from 'react';

interface MarketThesis {
  product_summary: string | null; core_problem: string | null; primary_user: string | null;
  economic_buyer: string | null; beachhead: string | null; geography: string | null;
  primary_use_case: string | null; adjacent_technologies: string[]; excluded_markets: string[];
}
interface Hypothesis { id: string; label: string; definition: string; thesis_version: number; status: string; position: number }
interface Candidate { label: string; definition: string }

const BLANK: MarketThesis = {
  product_summary: null, core_problem: null, primary_user: null, economic_buyer: null,
  beachhead: null, geography: null, primary_use_case: null, adjacent_technologies: [], excluded_markets: [],
};

type TextFieldKey = 'product_summary' | 'core_problem' | 'primary_user' | 'economic_buyer' | 'beachhead' | 'geography' | 'primary_use_case';
const FIELDS: { key: TextFieldKey; label: string; placeholder: string }[] = [
  { key: 'product_summary', label: 'What do you do?', placeholder: 'A biochip that detects X from a drop of blood in under 10 minutes.' },
  { key: 'core_problem', label: 'What core problem does it solve?', placeholder: 'Late diagnosis, because current tests take days and a lab.' },
  { key: 'primary_user', label: 'Who uses it?', placeholder: 'Nurses in primary care clinics.' },
  { key: 'economic_buyer', label: 'Who pays / decides?', placeholder: 'Hospital procurement, or the clinic owner.' },
  { key: 'beachhead', label: 'First segment to attack', placeholder: 'Private clinics in Portugal.' },
  { key: 'geography', label: 'Geography', placeholder: 'Portugal, then EU.' },
  { key: 'primary_use_case', label: 'Primary use case', placeholder: 'Point-of-care screening during a routine visit.' },
];
const MAX_TAGS = 8;

function TagInput({ label, values, onChange, placeholder }: {
  label: string; values: string[]; onChange: (next: string[]) => void; placeholder: string;
}) {
  const [draft, setDraft] = useState('');
  function add() {
    const v = draft.trim().slice(0, 60);
    setDraft('');
    if (!v || values.length >= MAX_TAGS || values.includes(v)) return;
    onChange([...values, v]);
  }
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium text-gray-500">{label}</label>
      <div className="flex flex-wrap items-center gap-1.5 rounded border border-gray-300 p-1.5">
        {values.map((v) => (
          <span key={v} className="flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700">
            {v}
            <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} className="text-gray-400 hover:text-[#B00000]">✕</button>
          </span>
        ))}
        {values.length < MAX_TAGS && (
          <input value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            onBlur={add} placeholder={values.length === 0 ? placeholder : 'Add…'} maxLength={60}
            className="min-w-[100px] flex-1 border-none px-1 py-0.5 text-xs outline-none" />
        )}
      </div>
    </div>
  );
}

function HypothesisCard({ hypothesis, editing, onStartEdit, onCancelEdit, onSave, onArchive }: {
  hypothesis: Hypothesis; editing: boolean;
  onStartEdit: () => void; onCancelEdit: () => void;
  onSave: (patch: { label: string; definition: string }) => void; onArchive: () => void;
}) {
  const [label, setLabel] = useState(hypothesis.label);
  const [definition, setDefinition] = useState(hypothesis.definition);

  if (!editing) {
    return (
      <div className="rounded-lg border border-gray-200 p-2.5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-gray-800">{hypothesis.label}</p>
            <p className="mt-0.5 text-xs text-gray-500">{hypothesis.definition}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={onStartEdit} className="text-[11px] font-medium text-[#0E7490] hover:underline">Edit</button>
            <button type="button" onClick={onArchive} className="text-[11px] text-gray-400 hover:underline">Archive</button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-[#0E7490] p-2.5">
      <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200}
        className="w-full rounded border border-gray-300 px-2 py-1 text-sm font-medium" />
      <textarea value={definition} onChange={(e) => setDefinition(e.target.value)} rows={2} maxLength={500}
        className="mt-1.5 w-full resize-none rounded border border-gray-300 px-2 py-1 text-xs" />
      <div className="mt-1.5 flex items-center gap-2">
        <button type="button" onClick={() => onSave({ label: label.trim(), definition: definition.trim() })}
          disabled={!label.trim() || !definition.trim()}
          className="text-[11px] font-medium text-[#0E7490] hover:underline disabled:opacity-40">Save</button>
        <button type="button" onClick={onCancelEdit} className="text-[11px] text-gray-400 hover:underline">Cancel</button>
      </div>
    </div>
  );
}

export function MarketThesisSection() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [thesis, setThesis] = useState<MarketThesis>(BLANK);
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [genError, setGenError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  function load() {
    fetch('/api/market-thesis').then((r) => r.json()).then((body: { available: boolean; thesis?: MarketThesis | null; hypotheses?: Hypothesis[] }) => {
      if (!body.available) { setAvailable(false); return; }
      setAvailable(true);
      setThesis(body.thesis ? { ...BLANK, ...body.thesis } : BLANK);
      setHypotheses(body.hypotheses ?? []);
    }).catch(() => setAvailable(false));
  }
  useEffect(load, []);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/market-thesis', {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(thesis),
      });
      if (res.ok) setSavedAt(Date.now());
    } finally { setSaving(false); }
  }

  async function generate() {
    setGenerating(true); setGenError(''); setCandidates(null);
    try {
      const res = await fetch('/api/market-thesis/hypotheses/generate', { method: 'POST' });
      const body = await res.json();
      if (!body.ok) { setGenError(body.error ?? 'Could not generate hypotheses — try again.'); return; }
      setCandidates(body.candidates ?? []);
    } catch {
      setGenError('Could not generate hypotheses — try again.');
    } finally { setGenerating(false); }
  }

  async function confirmCandidates() {
    if (!candidates || candidates.length === 0) return;
    setConfirming(true); setGenError('');
    try {
      const res = await fetch('/api/market-thesis/hypotheses', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hypotheses: candidates }),
      });
      const body = await res.json();
      if (!body.ok) { setGenError(body.error ?? 'Could not save these hypotheses — try again.'); return; }
      setCandidates(null);
      load();
    } finally { setConfirming(false); }
  }

  async function updateHypothesis(id: string, patch: { label?: string; definition?: string; status?: string }) {
    await fetch(`/api/market-thesis/hypotheses/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch),
    });
    setEditingId(null);
    load();
  }

  // Capability not live yet (unmigrated environment) — fail quietly rather
  // than block the rest of the tab that DOES work.
  if (available === false) return null;
  if (available === null) return <p className="text-xs text-gray-400">Loading your Market Thesis…</p>;

  const ready = !!thesis.product_summary?.trim() && !!thesis.core_problem?.trim();
  const canGenerate = ready && hypotheses.length < 3;

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-900">Market Thesis</h2>
      <p className="mt-1 text-xs text-gray-500">
        Tell Sherlock what you actually do — this grounds every market search from here on, instead of guessing from your sector tags.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label className="mb-1 block text-[11px] font-medium text-gray-500">{f.label}</label>
            <input value={thesis[f.key] ?? ''} maxLength={300} placeholder={f.placeholder}
              onChange={(e) => setThesis((prev) => ({ ...prev, [f.key]: e.target.value }))}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
        ))}
        <TagInput label="Adjacent technologies" values={thesis.adjacent_technologies}
          onChange={(next) => setThesis((prev) => ({ ...prev, adjacent_technologies: next }))}
          placeholder="Add and press Enter…" />
        <TagInput label="Excluded markets — don't compare us to…" values={thesis.excluded_markets}
          onChange={(next) => setThesis((prev) => ({ ...prev, excluded_markets: next }))}
          placeholder="Add and press Enter…" />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={() => void save()} disabled={saving}
          className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
          {saving ? 'Saving…' : savedAt && Date.now() - savedAt < 2000 ? 'Saved ✓' : 'Save'}
        </button>
      </div>

      {hypotheses.length > 0 && (
        <div className="mt-4 border-t border-gray-100 pt-3">
          <h3 className="text-xs font-semibold text-gray-500">Market hypotheses</h3>
          <div className="mt-2 space-y-2">
            {hypotheses.map((h) => (
              <HypothesisCard key={h.id} hypothesis={h} editing={editingId === h.id}
                onStartEdit={() => setEditingId(h.id)} onCancelEdit={() => setEditingId(null)}
                onSave={(patch) => void updateHypothesis(h.id, patch)}
                onArchive={() => void updateHypothesis(h.id, { status: 'archived' })} />
            ))}
          </div>
        </div>
      )}

      {canGenerate && !candidates && (
        <button type="button" onClick={() => void generate()} disabled={generating}
          className="mt-3 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">
          {generating ? 'Generating…' : 'Generate hypotheses'}
        </button>
      )}
      {genError && <p className="mt-2 text-[11px] text-[#B00000]">{genError}</p>}

      {candidates && (
        <div className="mt-3 space-y-2 rounded-lg border border-gray-100 bg-gray-50/60 p-3">
          <p className="text-[11px] text-gray-500">Review before creating — edit, remove, or regenerate.</p>
          {candidates.map((c, i) => (
            <div key={i} className="rounded border border-gray-200 bg-white p-2">
              <input value={c.label} maxLength={200}
                onChange={(e) => setCandidates((prev) => (prev ?? []).map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                className="w-full border-none text-sm font-medium outline-none" />
              <textarea value={c.definition} rows={2} maxLength={500}
                onChange={(e) => setCandidates((prev) => (prev ?? []).map((x, j) => (j === i ? { ...x, definition: e.target.value } : x)))}
                className="mt-1 w-full resize-none border-none text-xs text-gray-600 outline-none" />
              <button type="button" onClick={() => setCandidates((prev) => (prev ?? []).filter((_, j) => j !== i))}
                className="text-[11px] text-gray-400 hover:text-[#B00000]">Remove</button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void confirmCandidates()} disabled={confirming || candidates.length === 0}
              className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
              {confirming ? 'Creating…' : `Create ${candidates.length} hypothes${candidates.length === 1 ? 'is' : 'es'}`}
            </button>
            <button type="button" onClick={() => void generate()} disabled={generating} className="text-xs text-gray-400 hover:underline">Regenerate</button>
            <button type="button" onClick={() => setCandidates(null)} className="text-xs text-gray-400 hover:underline">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
