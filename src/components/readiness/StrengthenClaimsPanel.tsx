'use client';
// Prompt 358 §3.4 — "Strengthen your claims": specific advice or silence.
// Never the old repeated template ("add who/when/outcome" under every
// claim, verbatim, including claims that were already specific enough).
// Eligibility and the exact missing dimensions come from the pure,
// mechanical strengthenGaps (company-claims.ts) — this component only
// renders what that function decides, never re-derives it.
//
// Prompt 374 — the single home for this feature (§A: it used to also live,
// separately, in ReviewPanel and BlueprintPanel, plus a THIRD, older,
// read-only card inside ActionPlanPanel itself — three independently
// fetching copies of the same "accepted claims" data, which is the real
// mechanism behind the "applying a stronger version looks like it created a
// duplicate card" report in §D: editing via ONE panel never told the OTHER
// two's stale local copy to refresh, so the same claim's old and new text
// could show side by side across tabs in the same session, never as an
// actual duplicate DB row (the edit is a real UPDATE ... WHERE id, see the
// claim route). Now there is exactly one panel, exactly one fetch, so that
// specific staleness can no longer happen. §B adds explanation/example/
// provenance to every card and lets the founder correct a wrong category
// inline (often the REAL bug — see strengthenGaps' own comment on the
// Portugal Ventures case); §C adds a real exit (dismiss/reject) with undo.
import { useState } from 'react';
import {
  strengthenGaps, claimProvenanceLabel, DIMENSION_EXPLANATION, CATEGORY_LABEL, type StrengthenDimension,
} from '@/lib/company-claims';
import type { CompanyClaim, ClaimCategory } from '@/lib/types';

const CATEGORIES: ClaimCategory[] = [
  'problema', 'solucao', 'prova_tecnica', 'validacao_externa',
  'tracao_gtm', 'equipa', 'mercado_timing', 'funding', 'ask',
];

async function postClaimAction(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('/api/blueprint/claim', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.ok !== false, error: json.error };
}

function Card({ claim, missing, onChanged }: { claim: CompanyClaim; missing: StrengthenDimension[]; onChanged: () => void }) {
  const [drafts, setDrafts] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [category, setCategory] = useState<ClaimCategory>(claim.category);

  async function suggest() {
    setBusy(true); setNote('');
    try {
      const res = await fetch('/api/blueprint/strengthen-suggest', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ claimId: claim.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (body.rewrite) setDrafts(body.rewrite);
      else setNote(body.message ?? body.error ?? 'Nothing on file yet fills this in.');
    } finally { setBusy(false); }
  }

  async function apply() {
    if (!drafts?.trim()) return;
    setBusy(true); setNote('');
    try {
      const { ok, error } = await postClaimAction({ id: claim.id, action: 'edit', statement: drafts, category });
      if (!ok) { setNote(error ?? 'Could not save this — please try again.'); return; }
      setDrafts(undefined);
      onChanged();
    } finally { setBusy(false); }
  }

  // Prompt 374 §B — correcting the category alone (no rewrite) still goes
  // through 'edit' with the SAME statement: the route recomputes
  // evidence_class/specificity either way, and — often — the correction
  // alone makes this card disappear (a structured category like funding/ask
  // is exempt from strengthenGaps entirely; see that function's header).
  async function saveCategory(next: ClaimCategory) {
    setCategory(next);
    setBusy(true); setNote('');
    try {
      const { ok, error } = await postClaimAction({ id: claim.id, action: 'edit', statement: claim.statement, category: next });
      if (!ok) { setNote(error ?? 'Could not save this — please try again.'); return; }
      onChanged();
    } finally { setBusy(false); }
  }

  async function dismiss() {
    setBusy(true);
    try {
      const { ok, error } = await postClaimAction({ id: claim.id, action: 'dismiss_strengthen' });
      if (!ok) { setNote(error ?? 'Could not save this — please try again.'); return; }
      onChanged();
    } finally { setBusy(false); }
  }

  async function notMine() {
    setBusy(true);
    try {
      const { ok, error } = await postClaimAction({ id: claim.id, action: 'reject' });
      if (!ok) { setNote(error ?? 'Could not save this — please try again.'); return; }
      onChanged();
    } finally { setBusy(false); }
  }

  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-gray-400">{claimProvenanceLabel(claim)}</p>
        <select value={category} onChange={(e) => saveCategory(e.target.value as ClaimCategory)} disabled={busy}
          className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] text-gray-600 disabled:opacity-40">
          {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
      </div>
      <p className="mt-1 text-sm text-gray-800">&ldquo;{claim.statement}&rdquo;</p>
      <ul className="mt-1.5 space-y-1">
        {missing.map((m) => (
          <li key={m} className="text-xs text-gray-500">
            <span className="font-medium text-gray-600">Missing {m === 'who' ? 'who' : m === 'when' ? 'a date' : 'the outcome'}.</span>{' '}
            {DIMENSION_EXPLANATION[m].why} <span className="text-gray-400">{DIMENSION_EXPLANATION[m].example}</span>
          </li>
        ))}
      </ul>

      {drafts !== undefined ? (
        <>
          <textarea value={drafts} onChange={(e) => setDrafts(e.target.value)} rows={2}
            className="mt-2 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm" />
          <div className="mt-1.5 flex gap-2">
            <button onClick={apply} disabled={busy} className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">
              Apply
            </button>
            <button onClick={() => setDrafts(undefined)} className="text-xs text-gray-400 hover:underline">Cancel</button>
          </div>
        </>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button onClick={suggest} disabled={busy}
            className="rounded-lg border border-[#0E7490] px-2.5 py-1 text-xs font-medium text-[#0E7490] hover:bg-[#E8F4F8] disabled:opacity-40">
            {busy ? 'Thinking…' : 'Suggest a stronger version'}
          </button>
          <button onClick={dismiss} disabled={busy} className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40">
            Está bem assim
          </button>
          <button onClick={notMine} disabled={busy} className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40">
            Não é um facto meu
          </button>
        </div>
      )}
      {note && <p className="mt-1 text-[11px] text-amber-700">{note}</p>}
    </div>
  );
}

export function StrengthenClaimsPanel({ claims, onApplied }: { claims: CompanyClaim[]; onApplied: () => void }) {
  const [showDismissed, setShowDismissed] = useState(false);

  const accepted = claims.filter((c) => c.status === 'accepted');
  const items = accepted
    .filter((c) => !c.strengthenDismissedAt)
    .map((c) => ({ claim: c, missing: strengthenGaps(c) }))
    .filter((x): x is { claim: CompanyClaim; missing: StrengthenDimension[] } => x.missing !== null);
  const dismissed = accepted.filter((c) => !!c.strengthenDismissedAt && strengthenGaps(c) !== null);

  async function undismiss(claimId: string) {
    await postClaimAction({ id: claimId, action: 'undismiss_strengthen' });
    onApplied();
  }

  if (items.length === 0 && dismissed.length === 0) {
    return <p className="text-sm text-gray-500">Your claims are specific — nothing to strengthen here.</p>;
  }

  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <p className="text-sm text-gray-500">Your claims are specific — nothing to strengthen here.</p>
      ) : (
        items.map(({ claim, missing }) => <Card key={claim.id} claim={claim} missing={missing} onChanged={onApplied} />)
      )}

      {dismissed.length > 0 && (
        <div>
          <button onClick={() => setShowDismissed((v) => !v)} className="text-xs text-gray-400 hover:underline">
            {showDismissed ? 'Hide' : 'Show'} dismissed ({dismissed.length})
          </button>
          {showDismissed && (
            <ul className="mt-2 space-y-1.5">
              {dismissed.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 bg-gray-50 p-2 text-xs text-gray-500">
                  <span>&ldquo;{c.statement}&rdquo;</span>
                  <button onClick={() => undismiss(c.id)} className="shrink-0 text-[#0E7490] hover:underline">Undo</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
