'use client';
// Company tab redesign — Round card. `Flexible` + its note travel with the
// round wherever it's shown elsewhere (Dashboard "Round progress",
// readiness/ReviewPanel's companyContext, etc. — future prompts wire
// those reads; this card is the one place that writes them).
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { PropagationConfirm } from '@/components/PropagationConfirm';
import type { RoundField } from '@/lib/round-propagation';
import { Card } from '@/components/ui';
import { CompletenessField } from './CompletenessField';
import { AiSupportButton } from './AiSupportButton';
import type { CompletenessField as Field } from '@/lib/companyCompleteness';
import type { Stage } from '@/lib/types';
import { deriveValuation, type ValuationBasis } from '@/lib/dilution';
import {
  RoundFieldHint, RoundVaultPointer, roundFieldDecision, useRoundSuggestions,
} from './RoundVaultHints';
import { roundValueKey, type RoundFieldCandidate, type RoundFieldValue, type RoundSourceField } from '@/lib/round-field-precedence';

const STAGES: { value: Stage; label: string }[] = [
  { value: 'pre_seed', label: 'Pre-seed' }, { value: 'seed', label: 'Seed' },
  { value: 'series_a', label: 'Series A' }, { value: 'later', label: 'Later' }, { value: 'other', label: 'Other' },
];
const INSTRUMENTS = [
  { value: 'equity', label: 'Equity' }, { value: 'safe', label: 'SAFE' }, { value: 'convertible_note', label: 'Convertible note' },
  { value: 'venture_debt', label: 'Venture debt' }, { value: 'grant', label: 'Grant / subsidy' },
  { value: 'revenue_based', label: 'Revenue-based' }, { value: 'other', label: 'Other' },
];

export function RoundCard({ canEdit, missing, flashId }: { canEdit: boolean; missing: Field[]; flashId: string | null }) {
  const { db, updateOrg } = useStore();
  const org = db.org;
  // Prompt 541 §D — what the founder's own Vault already says about this
  // round. Loaded once on mount; the endpoint reports `available: false`
  // (and this stays inert) whenever migration 0298 or the extraction
  // pipeline is not in place.
  const suggestions = useRoundSuggestions();
  // Which fields were filled by accepting a suggestion in THIS edit session,
  // and from where. Used at save time to record provenance — and checked
  // against the final value first, so a founder who accepts a suggestion and
  // then edits it ends up with a manual field, as they should.
  const [accepted, setAccepted] = useState<Partial<Record<RoundSourceField, RoundFieldCandidate>>>({});
  // Conflicts answered with "Keep this" in this session. The server record
  // is written immediately; this only stops the notice re-rendering before
  // the next page load.
  const [resolvedLocally, setResolvedLocally] = useState<RoundSourceField[]>([]);
  const missingIds = new Set(missing.map((f) => f.id));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{
    raising: string; stage: string; stage_other: string; target: string; secured: string;
    instruments: string[]; instrument_other: string; valuation: string; valuation_basis: ValuationBasis; runway: string; runway_post: string;
    min_ticket: string; close_date: string; use_of_funds: string; flexible: boolean; flexible_note: string;
  } | null>(null);
  // Prompt 115 Block E — orgs.round_valuation_basis is a propose-only
  // migration (0111); the toggle below always renders (the derived-values
  // math needs no schema), but the save only *persists* the basis once this
  // probe confirms the column exists — same "never send a key the probe
  // hasn't cleared" discipline as every other migration-gated field here.
  const [basisPersistable, setBasisPersistable] = useState(false);
  useEffect(() => {
    fetch('/api/me', { cache: 'no-store' }).then((r) => r.json())
      .then((me) => setBasisPersistable(!!me.capabilities?.roundValuationBasis))
      .catch(() => setBasisPersistable(false));
  }, []);

  function startEdit() {
    setDraft({
      raising: org.round_raising == null ? '' : org.round_raising ? 'yes' : 'no',
      stage: org.stage ?? '', stage_other: org.stage_other ?? '',
      target: org.round_target_eur != null ? String(org.round_target_eur) : '',
      secured: org.round_secured_eur != null ? String(org.round_secured_eur) : '',
      instruments: org.round_instruments ?? [], instrument_other: org.round_instrument_other ?? '',
      valuation: org.round_valuation_eur != null ? String(org.round_valuation_eur) : '',
      valuation_basis: org.round_valuation_basis ?? 'pre_money',
      runway: org.round_runway_months != null ? String(org.round_runway_months) : '',
      // Investor Workspace Fase 1 (prompt 54) — min ticket + post-round runway.
      runway_post: org.round_runway_post_months != null ? String(org.round_runway_post_months) : '',
      min_ticket: org.round_min_ticket_eur != null ? String(org.round_min_ticket_eur) : '',
      close_date: org.round_target_close_date ?? '', use_of_funds: org.round_use_of_funds ?? '',
      flexible: !!org.round_flexible, flexible_note: org.round_flexible_note ?? '',
    });
    setEditing(true);
  }

  // Prompt 383 — same fix as IdentityCard: a gate link (379 §A) lands here
  // with `flashId` set while the card is still in read mode, where an empty
  // field is a static "—"/"needed for 100%" line, never an input. Auto-enter
  // edit mode when the flash targets this card so the founder lands on a
  // writable field. Unlike IdentityCard's `identity.intro_pitch`, every
  // `round.*` id already has a matching element in BOTH modes (the read-mode
  // <dl> maps the same ids), so no extra id-wrapping is needed here.
  useEffect(() => {
    if (flashId?.startsWith('round.') && !editing) startEdit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashId]);


  // Prompt 541 §D — the bridge between the nine orgs columns and this
  // card's own draft shape. One map, used for reading the live value, for
  // applying an accepted suggestion, and for the save-time provenance
  // check: three places that must agree, so they read from one place.
  function liveValue(field: RoundSourceField): RoundFieldValue {
    const num = (v: string) => (v ? Number(v) : null);
    if (draft) {
      switch (field) {
        case 'round_target_eur': return num(draft.target);
        case 'round_instruments': return draft.instruments;
        case 'round_valuation_eur': return num(draft.valuation);
        case 'round_valuation_basis': return draft.valuation_basis;
        case 'round_runway_months': return num(draft.runway);
        case 'round_runway_post_months': return num(draft.runway_post);
        case 'round_target_close_date': return draft.close_date || null;
        case 'round_use_of_funds': return draft.use_of_funds || null;
        case 'round_min_ticket_eur': return num(draft.min_ticket);
      }
    }
    switch (field) {
      case 'round_target_eur': return org.round_target_eur ?? null;
      case 'round_instruments': return org.round_instruments ?? null;
      case 'round_valuation_eur': return org.round_valuation_eur ?? null;
      case 'round_valuation_basis': return org.round_valuation_basis ?? null;
      case 'round_runway_months': return org.round_runway_months ?? null;
      case 'round_runway_post_months': return org.round_runway_post_months ?? null;
      case 'round_target_close_date': return org.round_target_close_date ?? null;
      case 'round_use_of_funds': return org.round_use_of_funds ?? null;
      case 'round_min_ticket_eur': return org.round_min_ticket_eur ?? null;
    }
  }

  function decisionFor(field: RoundSourceField) {
    if (resolvedLocally.includes(field)) return { kind: 'none' } as const;
    return roundFieldDecision(suggestions, field, liveValue(field));
  }

  const instrumentLabel = (v: string) => INSTRUMENTS.find((i) => i.value === v)?.label ?? v;

  // Accepting a suggestion is the same gesture as Prompt 459's: it does not
  // save, it puts the value in front of the founder in edit mode so they
  // review it and press Save like any other change.
  function applySuggestion(field: RoundSourceField, value: RoundFieldValue, candidate: RoundFieldCandidate) {
    if (!editing) startEdit();
    const str = value == null ? '' : String(value);
    setDraft((prev) => {
      if (!prev) return prev;
      switch (field) {
        case 'round_target_eur': return { ...prev, target: str };
        case 'round_instruments': return { ...prev, instruments: Array.isArray(value) ? value : prev.instruments };
        case 'round_valuation_eur': return { ...prev, valuation: str };
        case 'round_valuation_basis': return { ...prev, valuation_basis: (value === 'post_money' ? 'post_money' : 'pre_money') as ValuationBasis };
        case 'round_runway_months': return { ...prev, runway: str };
        case 'round_runway_post_months': return { ...prev, runway_post: str };
        case 'round_target_close_date': return { ...prev, close_date: str };
        case 'round_use_of_funds': return { ...prev, use_of_funds: str };
        case 'round_min_ticket_eur': return { ...prev, min_ticket: str };
        default: return prev;
      }
    });
    setAccepted((prev) => ({ ...prev, [field]: candidate }));
  }

  // "Keep this" on a conflict. Writes no value — only the record that this
  // candidate was turned down, so the same notice is not raised on the next
  // visit. Sent on its own rather than waiting for a Save the founder may
  // never make.
  function keepOwn(field: RoundSourceField, candidate: RoundFieldCandidate) {
    const key = roundValueKey(candidate.value);
    if (key) updateOrg({}, { round_source_kept_own: { [field]: key } });
    setResolvedLocally((prev) => (prev.includes(field) ? prev : [...prev, field]));
  }

  function hint(field: RoundSourceField) {
    return (
      <RoundFieldHint
        decision={decisionFor(field)} field={field} instrumentLabel={instrumentLabel}
        onUse={(value, candidate) => applySuggestion(field, value, candidate)}
        onKeepOwn={(candidate) => keepOwn(field, candidate)} />
    );
  }

  // Only the fields whose accepted value SURVIVED to the save unchanged are
  // recorded as document-sourced. Everything else defaults to manual on the
  // server, which is the protective direction.
  function acceptedProvenance(): Record<string, { documentId: string; documentName: string; extractedAt: string }> {
    const out: Record<string, { documentId: string; documentName: string; extractedAt: string }> = {};
    for (const [field, candidate] of Object.entries(accepted) as [RoundSourceField, RoundFieldCandidate][]) {
      if (!candidate.documentId) continue;
      if (roundValueKey(liveValue(field)) !== roundValueKey(candidate.value)) continue;
      out[field] = { documentId: candidate.documentId, documentName: candidate.documentName, extractedAt: candidate.extractedAt };
    }
    return out;
  }

  function toggleInstrument(v: string) {
    if (!draft) return;
    setDraft({ ...draft, instruments: draft.instruments.includes(v) ? draft.instruments.filter((x) => x !== v) : [...draft.instruments, v] });
  }

  // Prompt 212 §B.5 — os valores de dinheiro da ronda aparecem em mais do
  // que um sitio. Antes de gravar, mostrar onde. So pergunta quando um
  // deles MUDA de facto: confirmar uma edicao de runway por causa de um
  // campo que ninguem tocou era ruido, e ruido treina a fechar sem ler.
  const [pendingSave, setPendingSave] = useState<{ field: RoundField; summary: string } | null>(null);

  function moneyChanged(): { field: RoundField; summary: string } | null {
    if (!draft) return null;
    const eurOrDash = (n: number | null | undefined) => (n == null ? '—' : `€${n.toLocaleString('en-US')}`);

    const nextTarget = draft.target ? Number(draft.target) : undefined;
    if ((org.round_target_eur ?? undefined) !== nextTarget) {
      return { field: 'round_target_eur', summary: `Round target: ${eurOrDash(org.round_target_eur)} → ${eurOrDash(nextTarget)}` };
    }
    const nextSecured = draft.secured ? Number(draft.secured) : undefined;
    if ((org.round_secured_eur ?? undefined) !== nextSecured) {
      return { field: 'round_secured_eur', summary: `Amount secured: ${eurOrDash(org.round_secured_eur)} → ${eurOrDash(nextSecured)}` };
    }
    return null;
  }

  function requestSave() {
    const change = moneyChanged();
    if (change) { setPendingSave(change); return; }
    save();
  }

  function save() {
    if (!draft) return;
    updateOrg({
      round_raising: draft.raising === '' ? undefined : draft.raising === 'yes',
      stage: (draft.stage || undefined) as Stage | undefined,
      stage_other: draft.stage === 'other' ? draft.stage_other.trim() || undefined : undefined,
      round_target_eur: draft.target ? Number(draft.target) : undefined,
      round_secured_eur: draft.secured ? Number(draft.secured) : undefined,
      round_instruments: draft.instruments,
      round_instrument_other: draft.instruments.includes('other') ? draft.instrument_other.trim() || undefined : undefined,
      round_valuation_eur: draft.valuation ? Number(draft.valuation) : undefined,
      round_valuation_basis: basisPersistable ? draft.valuation_basis : undefined,
      round_runway_months: draft.runway ? Number(draft.runway) : undefined,
      round_runway_post_months: draft.runway_post ? Number(draft.runway_post) : undefined,
      round_min_ticket_eur: draft.min_ticket ? Number(draft.min_ticket) : undefined,
      round_target_close_date: draft.close_date || undefined,
      round_use_of_funds: draft.use_of_funds.trim() || undefined,
      round_flexible: draft.flexible,
      round_flexible_note: draft.flexible ? draft.flexible_note.trim() || undefined : undefined,
    }, { round_source_accepted: acceptedProvenance() });
    setAccepted({});
    setPendingSave(null);
    setEditing(false);
  }

  const stageLabel = STAGES.find((s) => s.value === org.stage)?.label ?? org.stage ?? '—';
  const eur = (n?: number) => (n != null ? `€${n.toLocaleString('en-US')}` : '—');

  return (
    <>
    <Card title="Round" right={canEdit && !editing ? <button onClick={startEdit} className="text-xs text-cyan-700 hover:underline">Edit</button> : undefined}>
      {/* Prompt 541 §D — only while this Vault has never yielded a single
          round field. Disappears for good once it has. */}
      <RoundVaultPointer show={canEdit && suggestions.available && !suggestions.anyCandidate} />
      {editing && draft ? (
        <div className="space-y-3">
          <CompletenessField id="round.raising" label="Raising right now?" missing={missingIds.has('round.raising')} flashing={flashId === 'round.raising'}>
            <div className="flex gap-3 text-sm">
              <label className="flex items-center gap-1.5"><input type="radio" checked={draft.raising === 'yes'} onChange={() => setDraft({ ...draft, raising: 'yes' })} /> Yes</label>
              <label className="flex items-center gap-1.5"><input type="radio" checked={draft.raising === 'no'} onChange={() => setDraft({ ...draft, raising: 'no' })} /> No</label>
            </div>
          </CompletenessField>

          {draft.raising !== 'no' && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <CompletenessField id="round.stage" label="Stage" missing={missingIds.has('round.stage')} flashing={flashId === 'round.stage'}>
                  <select value={draft.stage} onChange={(e) => setDraft({ ...draft, stage: e.target.value })} className="rounded border border-gray-300 px-2 py-1 text-sm">
                    <option value="">—</option>
                    {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                  {draft.stage === 'other' && (
                    <input value={draft.stage_other} onChange={(e) => setDraft({ ...draft, stage_other: e.target.value })} placeholder="Describe the stage"
                      className="mt-1 rounded border border-gray-300 px-2 py-1 text-sm" />
                  )}
                </CompletenessField>
                <CompletenessField id="round.target" label="Amount to raise (EUR)" missing={missingIds.has('round.target')} flashing={flashId === 'round.target'}>
                  <input type="number" value={draft.target} onChange={(e) => setDraft({ ...draft, target: e.target.value })} className="rounded border border-gray-300 px-2 py-1 text-sm" />
                  {hint('round_target_eur')}
                </CompletenessField>
                <label className="flex flex-col gap-0.5 text-xs">
                  <span className="text-gray-500">Already secured (EUR)</span>
                  <input type="number" value={draft.secured} onChange={(e) => setDraft({ ...draft, secured: e.target.value })} className="rounded border border-gray-300 px-2 py-1 text-sm" />
                </label>
                <label className="flex flex-col gap-0.5 text-xs">
                  <span className="text-gray-500">Valuation / cap (EUR, optional)</span>
                  <div className="flex gap-1.5">
                    <input type="number" value={draft.valuation} onChange={(e) => setDraft({ ...draft, valuation: e.target.value })} className="w-full rounded border border-gray-300 px-2 py-1 text-sm" />
                    <select value={draft.valuation_basis} onChange={(e) => setDraft({ ...draft, valuation_basis: e.target.value as ValuationBasis })}
                      className="shrink-0 rounded border border-gray-300 px-1.5 py-1 text-sm">
                      <option value="pre_money">pre-money</option>
                      <option value="post_money">post-money</option>
                    </select>
                  </div>
                  {draft.valuation && draft.target && (() => {
                    const d = deriveValuation(draft.valuation_basis, Number(draft.valuation), Number(draft.target));
                    return (
                      <span className="mt-0.5 text-gray-400">
                        Pre-money {eur(d.preMoneyEur)} · Post-money {eur(d.postMoneyEur)} · Round {eur(d.roundEur)}
                      </span>
                    );
                  })()}
                  {!basisPersistable && (
                    <span className="mt-0.5 text-gray-400">The pre/post-money basis isn&apos;t saved yet — coming soon.</span>
                  )}
                  {hint('round_valuation_eur')}
                  {hint('round_valuation_basis')}
                </label>
                <label className="flex flex-col gap-0.5 text-xs">
                  <span className="text-gray-500">Minimum ticket (EUR, optional)</span>
                  <input type="number" value={draft.min_ticket} onChange={(e) => setDraft({ ...draft, min_ticket: e.target.value })} className="rounded border border-gray-300 px-2 py-1 text-sm" />
                  {hint('round_min_ticket_eur')}
                </label>
                <CompletenessField id="round.runway" label="Runway now (months)" missing={missingIds.has('round.runway')} flashing={flashId === 'round.runway'}>
                  <input type="number" value={draft.runway} onChange={(e) => setDraft({ ...draft, runway: e.target.value })} className="rounded border border-gray-300 px-2 py-1 text-sm" />
                  {hint('round_runway_months')}
                </CompletenessField>
                <label className="flex flex-col gap-0.5 text-xs">
                  <span className="text-gray-500">Runway post-round (months, optional)</span>
                  <input type="number" value={draft.runway_post} onChange={(e) => setDraft({ ...draft, runway_post: e.target.value })} className="rounded border border-gray-300 px-2 py-1 text-sm" />
                  {hint('round_runway_post_months')}
                </label>
                <CompletenessField id="round.target_close_date" label="Target close date" missing={missingIds.has('round.target_close_date')} flashing={flashId === 'round.target_close_date'}>
                  <input type="date" value={draft.close_date} onChange={(e) => setDraft({ ...draft, close_date: e.target.value })} className="rounded border border-gray-300 px-2 py-1 text-sm" />
                  {hint('round_target_close_date')}
                </CompletenessField>
              </div>

              <CompletenessField id="round.instruments" label="Instrument type" missing={missingIds.has('round.instruments')} flashing={flashId === 'round.instruments'}>
                <div className="flex flex-wrap gap-2">
                  {INSTRUMENTS.map((i) => (
                    <label key={i.value} className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs ${draft.instruments.includes(i.value) ? 'border-[#0E7490] bg-[#E8F4F8] text-[#0E7490]' : 'border-gray-300 text-gray-600'}`}>
                      <input type="checkbox" className="hidden" checked={draft.instruments.includes(i.value)} onChange={() => toggleInstrument(i.value)} />
                      {i.label}
                    </label>
                  ))}
                </div>
                {draft.instruments.includes('other') && (
                  <input value={draft.instrument_other} onChange={(e) => setDraft({ ...draft, instrument_other: e.target.value })} placeholder="Describe the instrument"
                    className="mt-1.5 w-full rounded border border-gray-300 px-2 py-1 text-sm" />
                )}
                {hint('round_instruments')}
              </CompletenessField>

              <CompletenessField id="round.use_of_funds" label={
                <span className="inline-flex items-center gap-1.5">
                  Use of funds
                  {/* Prompt 327 Pedido F — same gate, same component, same
                      "never applies automatically" discipline as the
                      Roadmap's own AI support button; appends the chosen
                      suggestion as a new line for the founder to edit. */}
                  <AiSupportButton kind="use_of_funds" onUse={(s) => setDraft({ ...draft, use_of_funds: draft.use_of_funds ? `${draft.use_of_funds}\n${s}` : s })} />
                </span>
              } missing={missingIds.has('round.use_of_funds')} flashing={flashId === 'round.use_of_funds'}>
                <textarea value={draft.use_of_funds} onChange={(e) => setDraft({ ...draft, use_of_funds: e.target.value })} rows={2} className="w-full rounded border border-gray-300 px-2 py-1 text-sm" />
                {hint('round_use_of_funds')}
              </CompletenessField>

              <label className="flex items-center gap-1.5 text-sm text-gray-700">
                <input type="checkbox" checked={draft.flexible} onChange={(e) => setDraft({ ...draft, flexible: e.target.checked })} /> Flexible
              </label>
              {draft.flexible && (
                <input value={draft.flexible_note} onChange={(e) => setDraft({ ...draft, flexible_note: e.target.value })} placeholder="In what way?"
                  className="w-full rounded border border-gray-300 px-2 py-1 text-sm" />
              )}
            </>
          )}

          <div className="flex gap-2">
            <button onClick={requestSave} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white">Save</button>
            <button onClick={() => setEditing(false)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div id="round.raising" className={`rounded p-1 text-sm transition-colors duration-700 ${flashId === 'round.raising' ? 'bg-amber-50 ring-2 ring-amber-300' : ''}`}>
            {org.round_raising == null ? (
              <span className="text-gray-400">
                Raising status not answered yet.
                {missingIds.has('round.raising') && <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">needed for 100%</span>}
              </span>
            ) : org.round_raising === false ? (
              <span className="text-gray-400">Not currently raising.</span>
            ) : null}
          </div>
          {org.round_raising === false ? null : (
            <>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                {/* Prompt 541 §D — the 4th tuple member is the orgs column
                    this cell shows, or null for cells no document can speak
                    to (stage is not extracted; secured is a fact about the
                    founder's live process, never a deck's to state). */}
                {([
                  ['round.stage', 'Stage', org.stage === 'other' ? (org.stage_other || 'Other') : stageLabel, null],
                  ['round.target', 'Target', org.round_target_eur != null ? `${eur(org.round_target_eur)}${org.round_flexible ? ' · FLEXIBLE' : ''}` : '', 'round_target_eur'],
                  ['round.secured', 'Secured', org.round_secured_eur != null ? eur(org.round_secured_eur) : '', null],
                  ['round.valuation', org.round_valuation_basis === 'post_money' ? 'Valuation (post-money)' : 'Valuation (pre-money)',
                    org.round_valuation_eur != null ? eur(org.round_valuation_eur) : '', 'round_valuation_eur'],
                  ['round.min_ticket', 'Min ticket', org.round_min_ticket_eur != null ? eur(org.round_min_ticket_eur) : '', 'round_min_ticket_eur'],
                  ['round.runway', 'Runway now', org.round_runway_months != null ? `${org.round_runway_months} mo` : '', 'round_runway_months'],
                  ['round.runway_post', 'Runway post-round', org.round_runway_post_months != null ? `${org.round_runway_post_months} mo` : '', 'round_runway_post_months'],
                  ['round.target_close_date', 'Target close', org.round_target_close_date ?? '', 'round_target_close_date'],
                ] as [string, string, string, RoundSourceField | null][]).map(([id, label, value, column]) => (
                  <div key={id} id={id} className={`rounded p-1 transition-colors duration-700 ${flashId === id ? 'bg-amber-50 ring-2 ring-amber-300' : ''}`}>
                    <dt className="flex items-center gap-1.5 text-xs text-gray-500">
                      {label}
                      {missingIds.has(id) && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">needed for 100%</span>}
                    </dt>
                    <dd>{value || '—'}</dd>
                    {canEdit && column && hint(column)}
                    {canEdit && column === 'round_valuation_eur' && hint('round_valuation_basis')}
                  </div>
                ))}
                <div id="round.instruments" className={`col-span-2 rounded p-1 transition-colors duration-700 ${flashId === 'round.instruments' ? 'bg-amber-50 ring-2 ring-amber-300' : ''}`}>
                  <dt className="flex items-center gap-1.5 text-xs text-gray-500">
                    Instrument
                    {missingIds.has('round.instruments') && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">needed for 100%</span>}
                  </dt>
                  <dd>{(org.round_instruments ?? []).map((v) => INSTRUMENTS.find((i) => i.value === v)?.label ?? v).join(', ') || '—'}</dd>
                  {canEdit && hint('round_instruments')}
                </div>
              </dl>
              {org.round_valuation_eur != null && org.round_target_eur != null && (() => {
                const d = deriveValuation(org.round_valuation_basis ?? 'pre_money', org.round_valuation_eur!, org.round_target_eur!);
                return (
                  <p className="text-xs text-gray-400">
                    Pre-money {eur(d.preMoneyEur)} · Post-money {eur(d.postMoneyEur)} · Round {eur(d.roundEur)}
                  </p>
                );
              })()}
              <div id="round.use_of_funds" className={`rounded p-1 text-xs transition-colors duration-700 ${flashId === 'round.use_of_funds' ? 'bg-amber-50 ring-2 ring-amber-300' : ''}`}>
                {org.round_use_of_funds ? <p className="text-gray-500"><b>Use of funds:</b> {org.round_use_of_funds}</p> : missingIds.has('round.use_of_funds') && (
                  <p className="text-amber-700">Use of funds needed for 100%</p>
                )}
                {canEdit && hint('round_use_of_funds')}
              </div>
              {org.round_flexible && org.round_flexible_note && <p className="text-xs text-amber-700"><b>Flexible:</b> {org.round_flexible_note}</p>}
            </>
          )}
        </div>
      )}
    </Card>
      {pendingSave && (
        <PropagationConfirm
          field={pendingSave.field}
          progressVisibleToInvestors={org.round_progress_visible_to_investors ?? true}
          summary={pendingSave.summary}
          onConfirm={save}
          onCancel={() => setPendingSave(null)} />
      )}
    </>
  );
}
