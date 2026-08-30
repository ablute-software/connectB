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
//
// Prompt 445 §G — research now lives HERE, under each hypothesis card,
// not at the org level: SectionResearchButton (reused, now requiring
// hypothesisId) and its pending items are scoped per hypothesis, never a
// global list mixing them (MarketDataPanel.tsx's old per-section research
// panel now just points here).
import { useEffect, useState } from 'react';
import { SectionResearchButton, SECTIONS, SECTION_LABEL, type Section, type SectionOutcome } from './SectionResearchButtons';
import { TIMEOUT_MESSAGE } from '@/lib/market-research-outcome';
import { MARKET_THESIS_TEXT_MAX, type MarketThesisTextFieldKey } from '@/lib/market-thesis';

interface MarketThesis {
  product_summary: string | null; core_problem: string | null; primary_user: string | null;
  economic_buyer: string | null; beachhead: string | null; geography: string | null;
  primary_use_case: string | null; adjacent_technologies: string[]; excluded_markets: string[];
}
interface Hypothesis { id: string; label: string; definition: string; thesis_version: number; status: string; position: number }
interface Candidate { label: string; definition: string }

// Prompt 471 §A — a suggestion now optionally carries its provenance: the
// zero-cost GET cascade (456/457) has none (it's derived from the org's own
// settings, not a document), while the new document-based pass always does
// (point 5 — "every suggestion says where it came from"). `source` is
// optional rather than the type splitting in two, since both kinds are
// otherwise handled identically everywhere else (placeholder text, the "+"
// accept button, the accept-on-Enter/ArrowRight gesture).
interface FieldSuggestion { value: string; source?: { documentName: string; page: number | null } }

const BLANK: MarketThesis = {
  product_summary: null, core_problem: null, primary_user: null, economic_buyer: null,
  beachhead: null, geography: null, primary_use_case: null, adjacent_technologies: [], excluded_markets: [],
};

type TextFieldKey = MarketThesisTextFieldKey;
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

interface PendingResearchItem {
  id: string; section: Section; title: string; detail: string; source_url: string | null;
  confidence: string | null; fact_status: string | null;
}

const FACT_STATUS_LABEL: Record<string, string> = {
  VALIDATED_FACT: 'Validated · 2+ independent sources agree',
  PARTIAL_FACT: 'Partial · one source only',
  CONFLICTING_FACT: 'Conflicting · sources disagree',
  INSUFFICIENT_FACT: 'Insufficient evidence',
};
const FACT_STATUS_STYLE: Record<string, string> = {
  VALIDATED_FACT: 'text-emerald-700', PARTIAL_FACT: 'text-gray-400',
  CONFLICTING_FACT: 'text-amber-700', INSUFFICIENT_FACT: 'text-gray-400',
};

// Prompt 445 §G — research collapsed by default per hypothesis card (a
// hypothesis you're not actively researching shouldn't cost a screenful);
// pending items are fetched (and accepted/rejected) per section, scoped
// entirely to THIS hypothesisId — never a list mixing hypotheses.
function HypothesisResearch({ hypothesisId }: { hypothesisId: string }) {
  const [open, setOpen] = useState(false);
  const [itemsBySection, setItemsBySection] = useState<Partial<Record<Section, PendingResearchItem[]>>>({});
  const [outcomeBySection, setOutcomeBySection] = useState<Partial<Record<Section, SectionOutcome>>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState<Section | null>(null);

  async function loadSection(section: Section) {
    const res = await fetch(`/api/market-data/research?hypothesisId=${encodeURIComponent(hypothesisId)}&section=${section}`);
    const body = await res.json().catch(() => null);
    if (body?.items) setItemsBySection((prev) => ({ ...prev, [section]: body.items }));
  }

  async function respond(id: string, section: Section, action: 'accept' | 'reject') {
    setBusyId(id);
    try {
      await fetch('/api/market-data/research/respond', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, action }),
      });
      setItemsBySection((prev) => ({ ...prev, [section]: (prev[section] ?? []).filter((i) => i.id !== id) }));
    } finally { setBusyId(null); }
  }

  // Prompt 447 §E — only ever the LLM's own self-reported confidence about
  // the research itself (`confidence`, high/medium/low) — never
  // insight_confidence (446), a different, calculated thing this button
  // doesn't depend on. Sequential, not parallel: addOrUpdateCompetitor's
  // own dedupe (players items) isn't safe under concurrent calls.
  async function acceptAllHighConfidence(section: Section) {
    setBatchBusy(section);
    try {
      const highConfidenceIds = (itemsBySection[section] ?? []).filter((i) => i.confidence === 'high').map((i) => i.id);
      for (const id of highConfidenceIds) {
        await respond(id, section, 'accept');
      }
    } finally {
      setBatchBusy(null);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-2 text-[11px] font-medium text-[#0E7490] hover:underline">
        Research this hypothesis →
      </button>
    );
  }

  const activeSections = SECTIONS.filter((s) => outcomeBySection[s] || (itemsBySection[s]?.length ?? 0) > 0);

  return (
    <div className="mt-2 border-t border-gray-100 pt-2">
      <div className="flex flex-wrap gap-1.5">
        {SECTIONS.map((s) => (
          <SectionResearchButton key={s} section={s} hypothesisId={hypothesisId}
            // Prompt 470 §A point 3 — this IS the real reload mechanism for
            // this list (loadSection, already used elsewhere in this same
            // component), reached through onDone since SectionResearchButton
            // has no other handle on it. Sequenced deliberately: await the
            // reload BEFORE setting the outcome, so — same discipline as
            // Prompt 468's MarketPortraitCard — a timeout message never
            // renders ahead of the founder seeing whatever actually got
            // saved. onDone's own type stays `(outcome) => void`; the caller
            // never awaits it, so this only delays when THIS callback's own
            // state updates land, never the button's re-enable.
            //
            // .catch(() => {}) is load-bearing, not decorative: loadSection's
            // own `fetch` can reject outright on a real network failure
            // (unlike a non-2xx response, which fetch resolves, not
            // rejects). Without this, that rejection would propagate through
            // .then() and silently skip setOutcomeBySection entirely — the
            // founder would see NO message at all, which is worse than the
            // fire-and-forget version this replaces. The outcome must always
            // eventually show, whether or not the reload itself succeeded.
            onDone={(outcome) => { void loadSection(s).catch(() => {}).then(() => setOutcomeBySection((prev) => ({ ...prev, [s]: outcome }))); }} />
        ))}
      </div>

      {activeSections.map((s) => {
        const outcome = outcomeBySection[s];
        const items = itemsBySection[s] ?? [];
        const highConfidenceCount = items.filter((i) => i.confidence === 'high').length;
        return (
          <div key={s} className="mt-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{SECTION_LABEL[s]}</p>
            {/* Prompt 471 §B (Nuno's correction) — timeout is its own `kind`,
                rendered amber like MarketPortraitCard's identical case, never
                the same red as a real error: painting it red would repeat
                the exact "a red box asserts failed through color alone"
                mistake Prompt 468 §A had just fixed on the button next to
                this one. */}
            {outcome && (
              <p className={`mt-0.5 text-[11px] ${outcome.kind === 'error' ? 'text-[#B00000]' : outcome.kind === 'timeout' ? 'text-amber-700' : 'text-gray-400'}`}>
                {outcome.kind === 'error' ? outcome.message
                  : outcome.kind === 'timeout' ? TIMEOUT_MESSAGE
                  : outcome.kind === 'empty'
                    ? `Nothing with a verifiable source found${outcome.costEur != null ? ` · €${outcome.costEur.toFixed(3)} spent` : ''}.`
                    : `${outcome.count} item${outcome.count === 1 ? '' : 's'} found${outcome.costEur != null ? ` · €${outcome.costEur.toFixed(3)}` : ''}.`}
              </p>
            )}
            {/* Prompt 447 §E — never global, never medium/low, count always
                shown (never a bare "Accept all"). */}
            {highConfidenceCount > 0 && (
              <button type="button" disabled={batchBusy === s} onClick={() => void acceptAllHighConfidence(s)}
                className="mt-1 text-[11px] font-medium text-[#0E7490] hover:underline disabled:opacity-40">
                {batchBusy === s ? 'Accepting…' : `Accept all ${highConfidenceCount} high-confidence finding${highConfidenceCount === 1 ? '' : 's'}`}
              </button>
            )}
            {items.length > 0 && (
              <div className="mt-1 space-y-1.5">
                {items.map((item) => (
                  <div key={item.id} className="rounded border border-gray-200 p-2">
                    <p className="text-xs text-gray-800">{item.title}</p>
                    <p className="mt-0.5 text-[11px] text-gray-500">{item.detail}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2">
                      {item.source_url && (
                        <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="max-w-[200px] truncate text-[10px] text-[#0E7490] underline">
                          {item.source_url}
                        </a>
                      )}
                      {item.fact_status && (
                        <span className={`text-[10px] font-medium ${FACT_STATUS_STYLE[item.fact_status] ?? 'text-gray-400'}`}>
                          {FACT_STATUS_LABEL[item.fact_status] ?? item.fact_status}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex gap-1.5">
                      <button type="button" disabled={busyId === item.id} onClick={() => void respond(item.id, s, 'accept')}
                        className="rounded bg-[#0E7490] px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-40">
                        Accept ✓
                      </button>
                      <button type="button" disabled={busyId === item.id} onClick={() => void respond(item.id, s, 'reject')}
                        className="rounded border border-gray-300 px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                        Ignore
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
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
        <HypothesisResearch hypothesisId={hypothesis.id} />
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
  const [suggestions, setSuggestions] = useState<Partial<Record<TextFieldKey, FieldSuggestion>>>({});
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [genError, setGenError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Prompt 471 §A — the founder-initiated, document-based suggestion pass.
  // Kept separate from the passive GET load above: this one costs real
  // money (a model call) and must only ever run on an explicit click.
  const [docSuggestBusy, setDocSuggestBusy] = useState(false);
  const [docSuggestError, setDocSuggestError] = useState('');
  const [docSuggestResult, setDocSuggestResult] = useState<{ documentsRead: number; costEur: number; suggestedCount: number } | null>(null);

  function load() {
    fetch('/api/market-thesis').then((r) => r.json()).then((body: { available: boolean; thesis?: MarketThesis | null; hypotheses?: Hypothesis[]; suggestions?: Partial<Record<TextFieldKey, string>> }) => {
      if (!body.available) { setAvailable(false); return; }
      setAvailable(true);
      setThesis(body.thesis ? { ...BLANK, ...body.thesis } : BLANK);
      setHypotheses(body.hypotheses ?? []);
      // Prompt 471 §A — the zero-cost GET cascade (456/457) returns bare
      // strings with no provenance; wrapped here into the same
      // FieldSuggestion shape the document-based pass below returns, so
      // every render below only ever deals with one shape regardless of
      // which pass produced it.
      const raw = body.suggestions ?? {};
      setSuggestions(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, { value: v }])) as Partial<Record<TextFieldKey, FieldSuggestion>>);
    }).catch(() => setAvailable(false));
  }
  useEffect(load, []);

  function acceptSuggestion(key: TextFieldKey, value: string) {
    setThesis((prev) => ({ ...prev, [key]: value.slice(0, MARKET_THESIS_TEXT_MAX) }));
  }

  // Prompt 471 §A — founder-initiated only, never automatic: reads the
  // Vault's market-looking documents (same auto-pick heuristic as
  // MarketPortraitCard's "Read my documents") and asks for all 7 text
  // fields in one pass, never just the field that happens to hurt today —
  // see the route's own header for why that would repeat Prompt 457's
  // mistake. Returns suggestions only; nothing is written to the thesis
  // until the founder accepts one (acceptSuggestion above, unchanged).
  // Deliberately uncached — see the route's own comment for why clicking
  // this twice pays twice, on purpose, not by oversight.
  async function suggestFromDocuments() {
    // Adversarial pass (Prompt 471) — deliberately does NOT clear
    // docSuggestResult here: an earlier successful run's "not found in your
    // documents" notes (rendered below, keyed off docSuggestResult being
    // non-null) stay correct until a NEW result actually replaces them. The
    // first draft cleared it unconditionally at the top of this function,
    // which meant a failed retry (second click, e.g. a network blip) wiped
    // out a perfectly valid first result along with it — the founder would
    // lose real "not found" information to an unrelated later failure that
    // told them nothing new.
    setDocSuggestBusy(true); setDocSuggestError('');
    try {
      const res = await fetch('/api/market-thesis/suggest-from-documents', { method: 'POST' });
      const body = await res.json().catch(() => null) as {
        ok?: boolean; error?: string;
        suggestions?: Partial<Record<TextFieldKey, { value: string; documentName: string; page: number | null }>>;
        documentsRead?: number; costEur?: number;
      } | null;
      if (!body?.ok) { setDocSuggestError(body?.error ?? 'Could not read your documents — try again.'); return; }
      const found = body.suggestions ?? {};
      // Never overwrites a field the founder already filled in — the route
      // (market-thesis-document-suggest.ts) already drops those server-side,
      // so anything reaching `found` is safe to merge in directly. A
      // document-sourced suggestion replaces any earlier GET-only one for
      // the same field: it is strictly more informative (it carries a real
      // citation) and the founder just explicitly asked for it.
      setSuggestions((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(found) as TextFieldKey[]) {
          const s = found[key];
          if (s) next[key] = { value: s.value, source: { documentName: s.documentName, page: s.page } };
        }
        return next;
      });
      setDocSuggestResult({ documentsRead: body.documentsRead ?? 0, costEur: body.costEur ?? 0, suggestedCount: Object.keys(found).length });
    } catch {
      setDocSuggestError('Could not reach the server — check your connection and try again.');
    } finally { setDocSuggestBusy(false); }
  }

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

      {/* Prompt 471 §A — founder-initiated, additive to the zero-cost GET
          cascade above (never replaces it). Same single-click gesture as
          MarketPortraitCard's own document-reading button. */}
      <div className="mt-2">
        <button type="button" onClick={() => void suggestFromDocuments()} disabled={docSuggestBusy}
          className="text-[11px] font-medium text-[#0E7490] hover:underline disabled:opacity-40">
          {docSuggestBusy ? 'Reading your documents…' : 'Suggest from your documents'}
        </button>
        {docSuggestError && <p className="mt-1 text-[11px] text-[#B00000]">{docSuggestError}</p>}
        {docSuggestResult && (
          <p className="mt-1 text-[11px] text-gray-400">
            Read {docSuggestResult.documentsRead} document{docSuggestResult.documentsRead === 1 ? '' : 's'} · €{docSuggestResult.costEur.toFixed(3)}.
            {' '}
            {docSuggestResult.suggestedCount > 0
              ? `${docSuggestResult.suggestedCount} field${docSuggestResult.suggestedCount === 1 ? '' : 's'} suggested below.`
              : 'Nothing new found in those documents for the fields still empty.'}
          </p>
        )}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => {
          const suggestion = !thesis[f.key]?.trim() ? suggestions[f.key] : undefined;
          return (
            <div key={f.key}>
              <label className="mb-1 block text-[11px] font-medium text-gray-500">{f.label}</label>
              <div className="relative">
                <input
                  value={thesis[f.key] ?? ''} maxLength={300}
                  placeholder={suggestion?.value ?? f.placeholder}
                  onChange={(e) => setThesis((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (!suggestion) return;
                    if ((e.key === 'Enter' || e.key === 'ArrowRight') && e.currentTarget.selectionStart === 0 && !thesis[f.key]) {
                      e.preventDefault();
                      acceptSuggestion(f.key, suggestion.value);
                    }
                  }}
                  className={`w-full rounded border border-gray-300 px-2 py-1.5 text-sm ${suggestion ? 'pr-7' : ''}`} />
                {suggestion && (
                  <button type="button" onClick={() => acceptSuggestion(f.key, suggestion.value)}
                    aria-label="Use suggestion" title={suggestion.value}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-[#0E7490]">
                    +
                  </button>
                )}
              </div>
              {/* Prompt 471 §A point 5 — every document-sourced suggestion
                  says where it came from; a GET-cascade suggestion (no
                  `source`) shows nothing extra here, unchanged from before. */}
              {suggestion?.source && (
                <p className="mt-0.5 text-[10px] text-gray-400">
                  From <span className="font-medium">{suggestion.source.documentName}</span>{suggestion.source.page ? `, p.${suggestion.source.page}` : ''}
                </p>
              )}
              {/* Prompt 471 §A point 6 — "better empty than invented": once a
                  document pass has actually run, a field it still didn't
                  answer says so, rather than sitting blank with no
                  explanation. Never shown before the founder has asked —
                  an unrun field isn't a failure. */}
              {!suggestion && docSuggestResult && !thesis[f.key]?.trim() && (
                <p className="mt-0.5 text-[10px] text-gray-400">Not found in your documents.</p>
              )}
            </div>
          );
        })}
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
