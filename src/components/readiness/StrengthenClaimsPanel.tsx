'use client';
// Prompt 358 §3.4 — "Strengthen your claims": specific advice or silence.
// Never the old repeated template ("add who/when/outcome" under every
// claim, verbatim, including claims that were already specific enough).
// Eligibility and the exact missing dimensions come from the pure,
// mechanical strengthenGaps (company-claims.ts) — this component only
// renders what that function decides, never re-derives it.
import { useState } from 'react';
import { strengthenGaps, type StrengthenDimension } from '@/lib/company-claims';
import type { CompanyClaim } from '@/lib/types';

const DIMENSION_LABEL: Record<StrengthenDimension, string> = { who: 'who exactly', when: 'a date', outcome: 'the outcome' };

export function StrengthenClaimsPanel({ claims, onApplied }: { claims: CompanyClaim[]; onApplied: () => void }) {
  const items = claims
    .filter((c) => c.status === 'accepted')
    .map((c) => ({ claim: c, missing: strengthenGaps(c) }))
    .filter((x): x is { claim: CompanyClaim; missing: StrengthenDimension[] } => x.missing !== null);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  async function suggest(claimId: string) {
    setBusyId(claimId);
    setNotes((n) => ({ ...n, [claimId]: '' }));
    try {
      const res = await fetch('/api/blueprint/strengthen-suggest', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ claimId }),
      });
      const body = await res.json().catch(() => ({}));
      if (body.rewrite) setDrafts((d) => ({ ...d, [claimId]: body.rewrite }));
      else setNotes((n) => ({ ...n, [claimId]: body.message ?? body.error ?? 'Nothing on file yet fills this in.' }));
    } finally { setBusyId(null); }
  }

  async function apply(claimId: string, category: string) {
    const statement = drafts[claimId];
    if (!statement?.trim()) return;
    setBusyId(claimId);
    try {
      await fetch('/api/blueprint/claim', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: claimId, action: 'edit', statement, category }),
      });
      setDrafts((d) => { const next = { ...d }; delete next[claimId]; return next; });
      onApplied();
    } finally { setBusyId(null); }
  }

  if (items.length === 0) {
    return <p className="text-sm text-gray-500">Your claims are specific — nothing to strengthen here.</p>;
  }

  return (
    <div className="space-y-3">
      {items.map(({ claim, missing }) => (
        <div key={claim.id} className="rounded-lg border border-gray-200 p-3">
          <p className="text-sm text-gray-800">&ldquo;{claim.statement}&rdquo;</p>
          <p className="mt-1 text-xs text-gray-500">Missing: {missing.map((m) => DIMENSION_LABEL[m]).join(', ')}.</p>
          {drafts[claim.id] !== undefined ? (
            <>
              <textarea value={drafts[claim.id]} onChange={(e) => setDrafts((d) => ({ ...d, [claim.id]: e.target.value }))} rows={2}
                className="mt-2 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm" />
              <div className="mt-1.5 flex gap-2">
                <button onClick={() => apply(claim.id, claim.category)} disabled={busyId === claim.id}
                  className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">
                  Apply
                </button>
                <button onClick={() => setDrafts((d) => { const next = { ...d }; delete next[claim.id]; return next; })}
                  className="text-xs text-gray-400 hover:underline">
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <button onClick={() => suggest(claim.id)} disabled={busyId === claim.id}
              className="mt-2 rounded-lg border border-[#0E7490] px-2.5 py-1 text-xs font-medium text-[#0E7490] hover:bg-[#E8F4F8] disabled:opacity-40">
              {busyId === claim.id ? 'Thinking…' : 'Suggest a stronger version'}
            </button>
          )}
          {notes[claim.id] && <p className="mt-1 text-[11px] text-amber-700">{notes[claim.id]}</p>}
        </div>
      ))}
    </div>
  );
}
