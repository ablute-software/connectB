'use client';
// Prompt 298 §1 — extracted from BlueprintPanel.tsx §3 (the one-at-a-time
// interrogation UI) so Review can reuse the EXACT same flow instead of a
// second, drifting copy. Reused by BlueprintPanel.tsx and ReviewPanel.tsx.
//
// Two paths always available side by side (Prompt 298 §2, explicit ask):
// Manual — the founder types or pastes something already researched — and
// AI-assisted, whose button text is explicit about which of two roles AI
// plays for THIS question: 'draft' (the platform might already know this —
// generates a candidate from accepted claims) or 'polish' (only the founder
// can know this — AI can improve their own wording, never invent the
// answer). The role comes from the server (/api/blueprint/gap-assist),
// never guessed client-side.
import { useEffect, useState } from 'react';
import { browserClient } from '@/lib/supabase';

const SEVERITY_STYLE: Record<string, string> = { critical: 'bg-red-100 text-red-800', high: 'bg-amber-100 text-amber-800', medium: 'bg-gray-100 text-gray-600' };

// Prompt 358 Phase 1 — the ONE option, across every template, whose real
// answer is a document rather than text (company-gaps.ts's routeAnswer,
// 'attach_document'). Matched by exact string rather than importing
// routeAnswer here to keep this file free of the claims/gap-routing
// dependency — this file only ever renders what it's given.
const ATTACH_DOCUMENT_OPTION = 'Yes — I will attach it';

export interface GapView {
  rule: string; key: string; severity: string; message: string;
  prompt: { question: string; options: string[]; freeTextLabel: string };
  // Prompt 299 §2 — G7 spans several categories (unlike every other rule),
  // so its answer needs to carry the ORIGINAL claim's category through
  // rather than fall back to the answer route's one-category-per-rule map.
  meta?: Record<string, string>;
  // Prompt 358 Phase 1 — which claim(s) this gap is actually about; needed
  // client-side now that an answer can target an EXISTING claim (refresh,
  // set a disposition, or attach a document) instead of always creating a
  // new one. Always present in the server response (Gap's own field,
  // spread verbatim into the JSON) — declared here so TypeScript callers
  // can rely on it too.
  relatedClaimIds: string[];
  // Prompt 358 Phase 3.1 — short, investor-neutral reason this gap is worth
  // closing, for the Knowledge Health panel's "would strengthen" list.
  why: string;
  // Prompt 358 Phase 2.1 — a medium-confidence reconciliation match the
  // engine already found for this (G4-only) gap, if any. null for every
  // other rule and whenever nothing plausible was found.
  reconciliationSuggestion: { matchedDocumentId: string; matchedDocumentName: string; evidenceQuote: string | null; reasoning: string | null } | null;
}

interface VaultDocOption { id: string; name: string }

export function GapInterrogation({
  gap, remaining, busy, onSubmit, onAttachDocument, onReconcileConfirm,
}: {
  gap: GapView;
  remaining: number;
  busy: boolean;
  onSubmit: (opts: { option?: string; answer?: string; dismissed: boolean; category?: string }) => void | Promise<void>;
  // Prompt 358 Phase 1 — only G4 ever calls this (its "Yes — I will attach
  // it" option); optional so a caller that hasn't wired the Vault-picker
  // flow yet still compiles (the option would just fall through to a
  // normal text answer, same as before this prompt, rather than crash).
  onAttachDocument?: (claimId: string, documentId: string) => void | Promise<void>;
  // Prompt 358 Phase 2.1 — confirm or dismiss gap.reconciliationSuggestion.
  // Optional for the same reason as onAttachDocument above.
  onReconcileConfirm?: (claimId: string, confirm: boolean) => void | Promise<void>;
}) {
  const [option, setOption] = useState('');
  const [answer, setAnswer] = useState('');
  const [assisting, setAssisting] = useState(false);
  const [assistErr, setAssistErr] = useState('');
  const [assistRole, setAssistRole] = useState<'draft' | 'polish' | null>(null);
  const [vaultDocs, setVaultDocs] = useState<VaultDocOption[] | null>(null);
  const [selectedDocId, setSelectedDocId] = useState('');
  const [attaching, setAttaching] = useState(false);
  const [reconciling, setReconciling] = useState(false);

  const showDocPicker = option === ATTACH_DOCUMENT_OPTION && !!onAttachDocument;

  useEffect(() => {
    if (!showDocPicker || vaultDocs !== null) return;
    browserClient().from('documents').select('id, name').order('name').then(({ data }) => setVaultDocs((data ?? []) as VaultDocOption[]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDocPicker]);

  async function submitAttach() {
    if (!selectedDocId || !onAttachDocument) return;
    setAttaching(true);
    try {
      await onAttachDocument(gap.relatedClaimIds[0], selectedDocId);
    } finally { setAttaching(false); }
  }

  async function respondToSuggestion(confirm: boolean) {
    if (!onReconcileConfirm) return;
    setReconciling(true);
    try {
      await onReconcileConfirm(gap.relatedClaimIds[0], confirm);
    } finally { setReconciling(false); }
  }

  async function assist() {
    setAssisting(true); setAssistErr('');
    try {
      const res = await fetch('/api/blueprint/gap-assist', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gapKey: gap.key, currentAnswer: answer }),
      });
      const body = await res.json();
      if (!body.ok) { setAssistErr(body.error ?? 'AI assist failed.'); return; }
      setAssistRole(body.role);
      if (body.text) setAnswer(body.text);
      else if (body.message) setAssistErr(body.message);
    } catch { setAssistErr('AI assist failed.'); } finally { setAssisting(false); }
  }

  return (
    <div>
      <div className="flex items-start gap-2">
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${SEVERITY_STYLE[gap.severity] ?? 'bg-gray-100 text-gray-600'}`}>
          {gap.severity}
        </span>
        <p className="text-sm font-medium text-gray-900">{gap.prompt.question}</p>
      </div>
      <p className="mt-1 text-xs text-gray-500">{gap.message}</p>

      {gap.reconciliationSuggestion && onReconcileConfirm && (
        // Prompt 358 Phase 2.1 — "no question before the engine tried to
        // answer it itself": a medium-confidence match the reconciliation
        // pass already found, surfaced as a one-click confirm rather than
        // making the founder go find the document themselves.
        <div className="mt-2 rounded-lg border border-[#0E7490]/30 bg-[#E8F4F8] p-2.5">
          <p className="text-xs text-[#0E7490]">
            We think <span className="font-medium">{gap.reconciliationSuggestion.matchedDocumentName}</span> might already cover this.
            {gap.reconciliationSuggestion.reasoning ? ` ${gap.reconciliationSuggestion.reasoning}` : ''}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={() => respondToSuggestion(true)} disabled={reconciling || busy}
              className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
              Yes, that&apos;s it
            </button>
            <button onClick={() => respondToSuggestion(false)} disabled={reconciling || busy}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40">
              No, that&apos;s not it
            </button>
          </div>
        </div>
      )}

      {gap.prompt.options.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {gap.prompt.options.map((o) => (
            <button key={o} onClick={() => setOption(o === option ? '' : o)}
              className={`rounded-full border px-2.5 py-1 text-xs ${
                o === option ? 'border-[#0E7490] bg-[#E8F4F8] text-[#0E7490]' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
              {o}
            </button>
          ))}
        </div>
      )}

      {showDocPicker ? (
        // Prompt 358 Phase 1 — the real answer here is a document, never
        // text: "Yes — I will attach it" opens a picker over the Vault's
        // own documents instead of a free-text box, and the button links
        // it (link_claim_document_ref) rather than posting a claim reading
        // "Yes — I will attach it".
        <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-2.5">
          {vaultDocs === null ? (
            <p className="text-xs text-gray-400">Loading your Vault documents…</p>
          ) : vaultDocs.length === 0 ? (
            <p className="text-xs text-gray-400">No documents in your Vault yet — upload one first, then come back here.</p>
          ) : (
            <select value={selectedDocId} onChange={(e) => setSelectedDocId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm">
              <option value="">Select a document…</option>
              {vaultDocs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button onClick={submitAttach} disabled={!selectedDocId || attaching || busy}
              className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
              {attaching ? 'Linking…' : 'Link this document'}
            </button>
            <button onClick={() => setOption('')} disabled={busy} className="text-xs text-gray-400 hover:underline">
              Never mind
            </button>
          </div>
        </div>
      ) : (
        <>
          <textarea value={answer} onChange={(e) => { setAnswer(e.target.value); setAssistRole(null); }} rows={2}
            placeholder={gap.prompt.freeTextLabel}
            className="mt-2 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm" />

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button onClick={() => onSubmit({ option: option || undefined, answer: answer || undefined, dismissed: false, category: gap.meta?.category })}
              disabled={busy || (!option && !answer.trim())}
              className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
              Save answer
            </button>
            <button onClick={() => onSubmit({ dismissed: true })} disabled={busy}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40">
              Skip this one
            </button>
            <button onClick={assist} disabled={assisting || busy}
              className="rounded-lg border border-[#0E7490] px-3 py-1.5 text-xs font-medium text-[#0E7490] hover:bg-[#E8F4F8] disabled:opacity-40">
              {assisting ? 'Thinking…' : answer.trim() ? 'AI: polish my wording' : 'AI: draft from what we already know'}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-gray-400">
            {assistRole === 'polish' && 'AI improved your own wording — no new facts were added.'}
            {assistRole === 'draft' && 'AI drafted this from what\'s already on file (facts, team profiles, Vault documents) — check it before saving.'}
            {!assistRole && 'Your answer becomes a claim in your own words. Its strength is measured from what you write — never chosen.'}
          </p>
          {assistErr && <p className="mt-1 text-[11px] text-amber-700">{assistErr}</p>}
        </>
      )}
      {remaining > 1 && <p className="mt-1 text-[11px] text-gray-400">{remaining - 1} more after this one.</p>}
    </div>
  );
}
