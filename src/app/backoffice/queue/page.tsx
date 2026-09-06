'use client';
// BLOCO 3 — Fila: the 4 review queues, tabbed, each pending→decided.
// Contributions/GDPR logic carried over from the pre-Bloco-3 backoffice
// page; Submissions/Claims are new tabs consolidating what used to be a
// separate founder-store-scoped "Review queue" section.
import { Fragment, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Card, Tooltip } from '@/components/ui';
import { useConfirm } from '@/lib/confirm';
import { classifyConflict, type ConflictClass } from '@/lib/contribution-diff';
import { SuspiciousAccountsTab } from '@/components/backoffice/SuspiciousAccountsTab';
import { FraudFlagsTab } from '@/components/backoffice/FraudFlagsTab';
import { DomainMismatchTab } from '@/components/backoffice/DomainMismatchTab';
import { CompetitorIntelTab } from '@/components/backoffice/CompetitorIntelTab';
import { ENTITY_ENRICHMENT_FIELD_LABELS, isKnownEntityField } from '@/lib/entity-enrichment';
import { manualEntityCompleteness, ENRICHMENT_REQUEST_FIELD, type CompletenessGrade } from '@/lib/completeness';
import { QueueTable, type QueueColumn } from '@/components/backoffice/QueueTable';
import { QueueTriageBoard } from '@/components/backoffice/QueueTriageBoard';
import { groupIntoReviewCards, REVIEW_CARD_LABELS } from '@/lib/queue-summary';
import { ReviewQueueLayout, ReviewFacts, ReviewActionFooter } from '@/components/backoffice/ReviewQueueLayout';
import type { UnifiedIdentityRow } from '@/lib/investor-identity-row';
import type { MxLookupResult } from '@/lib/investor-domain-mx';

// Prompt 190 — 'candidates' ("Catalog candidates") added next to
// Contributions per Nuno's explicit decision: "Added by startups" (Prompt
// 187 §A) is review work, same pattern as Contributions, and doesn't
// belong hidden inside the Catalog page. Moved here verbatim from
// backoffice/catalog/page.tsx (the CatalogCandidatesTab/AddedByStartupsTab/
// QualityPanel section below) — no logic changes, per the prompt's own
// scope.
// Prompt 572 §B.1 — 'candidates' and 'submissions' merge into one
// 'new_investors' tab; both old keys stay valid Tab values (never routed to
// directly by TABS below, so they never render as a nav item) purely so
// BackofficeQueueContent's own redirect (see there) has something to match
// on an old bookmark/link.
type Tab = 'contributions' | 'new_investors' | 'candidates' | 'submissions' | 'claims' | 'identity' | 'gdpr' | 'trust_safety' | 'suspicious' | 'fraud' | 'key_people' | 'community' | 'domain_mismatch' | 'competitor_intel';

const TABS: { key: Tab; label: string }[] = [
  { key: 'new_investors', label: 'New investors' },
  { key: 'contributions', label: 'Contributions' },
  { key: 'identity', label: 'Investor identity' },
  // Prompt 574 §C — diagnosed: no LinkedIn OAuth entry point exists
  // anywhere in this codebase (a placeholder button behind
  // NEXT_PUBLIC_LINKEDIN_OAUTH_ENABLED, unset everywhere), and nothing
  // writes to profile_claims except this tab's own read. Left exactly as
  // it already was — collapses to "Queue clear" on its own, no new UI, per
  // the prompt's own explicit "não construir UI para uma fila sem porta."
  { key: 'claims', label: 'Person claims' },
  { key: 'gdpr', label: 'GDPR' },
  // Prompt 284 §1 — entities.email_domain vs entities.website mismatches
  // (54 in production, Nalka Invest being the case that surfaced it) —
  // live detection, not a stored flag, see DomainMismatchTab.tsx.
  // Prompt 573 §C — folded into Investor identity as a filter chip rather
  // than its own top-level tab; 'domain_mismatch' stays a valid Tab value
  // purely so an old ?tab=domain_mismatch link still redirects (see the
  // redirect effect near InvestorIdentityTab), same pattern 572 used for
  // 'candidates'/'submissions'.
  //
  // Prompt 574 §B — Suspicious accounts (Prompt 244/245, developer-
  // flagged) and Fraud reports (Prompt 277 A.3, founder-submitted) merge
  // into one Trust & safety tab with a source filter; 'suspicious'/'fraud'
  // stay valid Tab values purely so old ?tab=suspicious / ?tab=fraud links
  // redirect (see the redirect effect below), same pattern as above.
  { key: 'trust_safety', label: 'Trust & safety' },
  // Prompt 264 — bulk-promote verified key_people research to real
  // contacts, across every org (248 entities had this gap in production
  // at the time this shipped; a reusable screen, not a one-off fix).
  { key: 'key_people', label: 'Key people' },
  // Prompt 266 §6 — separate from "Contributions" above: that tab is one
  // org's authored edit vs the record on file; this one is two DIFFERENT
  // orgs independently agreeing on the same still-blank field — its own
  // review surface (catalog_field_consensus, not contributions).
  { key: 'community', label: 'Contributions — by users' },
  // Prompt 292 §Fase 1 — manual/admin path to feed the shared
  // investor_investments library (0201), see CompetitorIntelTab.tsx. Not
  // a review queue like the others above — a data-entry tool, but
  // platform-admin-only same as everything else here.
  { key: 'competitor_intel', label: 'Competitor intel' },
];

type Contribution = {
  id: string; subject_type: 'entity' | 'person'; subject_name: string; org_name: string;
  field: string; value: unknown; existing_value?: unknown; note: string | null; status: 'submitted' | 'verified' | 'rejected' | 'held';
  created_at: string; reviewer_notes: string | null;
  source: 'user' | 'ai'; confidence: number | null; source_url: string | null;
};

const CLASS_STYLE: Record<ConflictClass, string> = {
  cosmetic: 'bg-gray-100 text-gray-500',
  substantive: 'bg-amber-100 text-amber-800',
};

function fieldLabel(field: string): string {
  return isKnownEntityField(field) ? ENTITY_ENRICHMENT_FIELD_LABELS[field] : field;
}

function formatFieldValue(value: unknown): string {
  return Array.isArray(value) ? value.join(', ') : String(value);
}

function ContributionsTab() {
  const confirm = useConfirm();
  const [items, setItems] = useState<Contribution[] | null>(null);
  const [err, setErr] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [classFilter, setClassFilter] = useState<ConflictClass | 'all' | 'requests'>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [peopleOnly, setPeopleOnly] = useState(false);

  function refresh() {
    fetch('/api/backoffice/contributions').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setItems(body.contributions);
    });
  }
  useEffect(refresh, []);

  async function review(id: string, decision: 'verified' | 'rejected') {
    await fetch(`/api/backoffice/contributions/${id}/review`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, notes: notes[id] }),
    });
    refresh();
  }

  // Bulk is a UI convenience only — every id still goes through the exact
  // same single-item review endpoint, so per-row audit logging (who/when/
  // notes) is identical to reviewing one at a time.
  async function bulkReview(ids: string[], decision: 'verified' | 'rejected') {
    setBulkBusy(true);
    try {
      await Promise.all(ids.map((id) => fetch(`/api/backoffice/contributions/${id}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, notes: notes[id] }),
      })));
    } finally {
      setSelected(new Set());
      setBulkBusy(false);
      refresh();
    }
  }

  // Prompt 572 §C.2 — "__enrichment_request__ não é uma contribuição."
  // classifyConflict on a boolean demand-flag doesn't mean anything, and
  // mixing it into the cosmetic/substantive counts above overstated the
  // real backlog. Split before classifying, not after.
  const requestRows = useMemo(() => (items ?? []).filter((c) => c.field === ENRICHMENT_REQUEST_FIELD), [items]);
  const fieldRows = useMemo(() => (items ?? []).filter((c) => c.field !== ENRICHMENT_REQUEST_FIELD), [items]);
  const classified = useMemo(() => fieldRows.map((c) => ({
    ...c, cls: classifyConflict(c.existing_value, c.value) as ConflictClass,
  })), [fieldRows]);

  if (err) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!items) return <p className="text-sm text-gray-400">Loading…</p>;

  // Prompt 572 §C.2 — shown only under the Requests filter, and only
  // 'submitted' (still open / failed — EnrichmentBadge.tsx marks a
  // successful run 'verified' itself) by default; already-closed ones sit
  // behind their own "Show resolved"-style details, same convention as
  // held/reviewed below.
  const requestsOpen = requestRows.filter((c) => c.status === 'submitted');
  const requestsClosed = requestRows.filter((c) => c.status !== 'submitted');

  const pendingAllUnfiltered = classified.filter((c) => c.status === 'submitted');
  // Prompt 572 §C.4 — "Pessoas são um filtro, não uma fila": subject_type
  // ='person' rows stay in this same list, toggled by a checkbox rather
  // than living in a separate tab.
  const pendingAll = peopleOnly ? pendingAllUnfiltered.filter((c) => c.subject_type === 'person') : pendingAllUnfiltered;
  const personCount = pendingAllUnfiltered.filter((c) => c.subject_type === 'person').length;
  const cosmeticCount = pendingAll.filter((c) => c.cls === 'cosmetic').length;
  const substantiveCount = pendingAll.filter((c) => c.cls === 'substantive').length;
  const pending = classFilter === 'all' || classFilter === 'requests' ? pendingAll : pendingAll.filter((c) => c.cls === classFilter);
  // 'held' (migration 0034) — flagged by a human for a second look, not a
  // routine backlog row. Kept out of "Decided" (it isn't) and out of the
  // bulk-selectable pending list (no automatic rule should batch through
  // it either), shown in its own section instead.
  const held = classified.filter((c) => c.status === 'held');
  const reviewed = classified.filter((c) => c.status !== 'submitted' && c.status !== 'held');
  const groups = new Map<string, typeof pending>();
  for (const c of pending) {
    const key = `${c.subject_type}:${c.subject_name}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const visibleIds = pending.map((c) => c.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  // Prompt 266 §6 — global bulk-approval: every AI-sourced pending
  // contribution the model itself was already >=80% confident about.
  // Never touches user-authored rows (those have no confidence score at
  // all) — this is a volume shortcut for the AI-research backlog
  // specifically, not a blanket "approve everything" button.
  const highConfidenceAi = pendingAll.filter((c) => c.source === 'ai' && (c.confidence ?? 0) >= 0.8);

  async function bulkApproveHighConfidence() {
    if (!(await confirm({ message: `Approve ${highConfidenceAi.length} AI-sourced contribution${highConfidenceAi.length === 1 ? '' : 's'} at ≥80% confidence?` }))) return;
    bulkReview(highConfidenceAi.map((c) => c.id), 'verified');
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAllVisible() {
    setSelected((prev) => {
      if (allVisibleSelected) return new Set([...prev].filter((id) => !visibleIds.includes(id)));
      return new Set([...prev, ...visibleIds]);
    });
  }

  return (
    <Card title={`Contributions — cross-org (${pendingAllUnfiltered.length})`}>
      <p className="mb-3 text-xs text-gray-500">
        Authored edits from every org&apos;s own &quot;Add info,&quot; aggregated by subject, sources side by side.
        Most conflicts are cosmetic (case, accents, quotes, whitespace, code-vs-full-name) — classified automatically below.
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5 text-xs">
          {(['all', 'cosmetic', 'substantive'] as const).map((f) => (
            <button key={f} onClick={() => { setClassFilter(f); setSelected(new Set()); }}
              className={`rounded-full px-2.5 py-1 font-medium ${classFilter === f ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {f === 'all' ? `All (${pendingAll.length})` : f === 'cosmetic' ? `Cosmetic (${cosmeticCount})` : `Substantive (${substantiveCount})`}
            </button>
          ))}
          {/* Prompt 572 §C.2 — enrichment requests are a demand-flag, not a
              field diff; they only ever show up here, never mixed into the
              cards above. Defaults to open/failed only (see requestsOpen). */}
          <button onClick={() => { setClassFilter('requests'); setSelected(new Set()); }}
            className={`rounded-full px-2.5 py-1 font-medium ${classFilter === 'requests' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            Requests {requestsOpen.length > 0 ? `(${requestsOpen.length})` : ''}
          </button>
        </div>
        {classFilter !== 'requests' && personCount > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-gray-500">
            <input type="checkbox" checked={peopleOnly} onChange={(e) => { setPeopleOnly(e.target.checked); setSelected(new Set()); }} />
            People only ({personCount})
          </label>
        )}
        {classFilter !== 'requests' && pending.length > 0 && (
          <label className="ml-2 flex items-center gap-1.5 text-xs text-gray-500">
            <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} />
            Select all in view ({pending.length})
          </label>
        )}
        {classFilter !== 'requests' && highConfidenceAi.length > 0 && (
          <button disabled={bulkBusy} onClick={bulkApproveHighConfidence}
            className="rounded-lg border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-medium text-green-800 hover:bg-green-100 disabled:opacity-40">
            {bulkBusy ? 'Working…' : `Approve all ≥80% AI confidence (${highConfidenceAi.length})`}
          </button>
        )}
        {classFilter !== 'requests' && selected.size > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-gray-500">{selected.size} selected</span>
            <button disabled={bulkBusy} onClick={() => bulkReview([...selected], 'verified')}
              className="rounded bg-green-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-800 disabled:opacity-40">
              {bulkBusy ? 'Working…' : `Verify ${selected.size}`}
            </button>
            <button disabled={bulkBusy} onClick={() => bulkReview([...selected], 'rejected')}
              className="rounded border border-red-200 px-2.5 py-1 text-xs text-[#B00000] hover:bg-red-50 disabled:opacity-40">
              {bulkBusy ? 'Working…' : `Reject ${selected.size}`}
            </button>
          </div>
        )}
      </div>

      {classFilter === 'requests' ? (
        <div className="space-y-3">
          {requestsOpen.length === 0 ? <p className="text-sm text-gray-400">No open requests — every &quot;Request more info&quot; has either succeeded or failed and been reviewed.</p> : (
            <ul className="space-y-1.5">
              {requestsOpen.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-100 bg-amber-50 p-3 text-sm">
                  <span className="font-semibold">{c.subject_name}</span>
                  <span className="text-xs text-gray-400">({c.subject_type}) · {c.org_name} · {c.created_at.slice(0, 10)}</span>
                  {c.note && <span className="text-xs text-gray-500">— {c.note}</span>}
                  <span className="ml-auto text-xs font-medium text-amber-700">enrichment failed or still pending — retry, or dismiss</span>
                  <input placeholder="Reviewer notes" value={notes[c.id] ?? ''} onChange={(e) => setNotes({ ...notes, [c.id]: e.target.value })}
                    className="min-w-[160px] rounded border border-gray-200 px-2 py-1 text-xs" />
                  <button onClick={() => review(c.id, 'verified')} className="rounded bg-green-700 px-2 py-1 text-xs font-medium text-white hover:bg-green-800">Retry / mark done</button>
                  <button onClick={() => review(c.id, 'rejected')} className="rounded border border-red-200 px-2 py-1 text-xs text-[#B00000] hover:bg-red-50">Dismiss</button>
                </li>
              ))}
            </ul>
          )}
          {requestsClosed.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-gray-400">Closed ({requestsClosed.length})</summary>
              <ul className="mt-2 space-y-1 text-xs">
                {requestsClosed.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-1.5 py-0.5 font-semibold ${c.status === 'verified' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{c.status}</span>
                    <span>{c.subject_name}</span>
                    <span className="text-gray-400">{c.org_name}</span>
                    {c.reviewer_notes && <span className="text-gray-500">— {c.reviewer_notes}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      ) : (
        <>
          {groups.size === 0 ? <p className="text-sm text-gray-400">Queue clear.</p> : (
            <div className="space-y-3">
              {[...groups.entries()].map(([key, list]) => {
                const aiCount = list.filter((c) => c.source === 'ai').length;
                const userCount = list.length - aiCount;
                return (
                <div key={key} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                  <div className="mb-1.5 flex items-center justify-between">
                    <div className="text-sm font-semibold">
                      {list[0].subject_name} <span className="font-normal text-gray-400">({list[0].subject_type})</span>
                      <span className="ml-1.5 font-normal text-gray-400">
                        — {list.length} proposed change{list.length === 1 ? '' : 's'}
                        {aiCount > 0 && userCount > 0 ? ` (${aiCount} AI · ${userCount} user)` : ''}
                      </span>
                    </div>
                    {list.length > 1 && (
                      <button onClick={() => bulkReview(list.map((c) => c.id), 'verified')} disabled={bulkBusy}
                        className="rounded border border-green-200 bg-white px-2 py-0.5 text-[11px] font-medium text-green-800 hover:bg-green-50 disabled:opacity-40">
                        Verify all {list.length}
                      </button>
                    )}
                  </div>
                  <ul className="space-y-1.5">
                    {list.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
                        <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleOne(c.id)} />
                        <Tooltip text={c.cls === 'cosmetic' ? 'Same value after normalizing case/accents/quotes/whitespace.' : 'A genuinely different value from what is on record.'}>
                          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${CLASS_STYLE[c.cls]}`}>{c.cls}</span>
                        </Tooltip>
                        <span className="font-medium">{c.field}:</span>
                        {c.existing_value != null && c.existing_value !== '' ? (
                          <span className="text-gray-400">{formatFieldValue(c.existing_value)} →</span>
                        ) : null}
                        <span>{formatFieldValue(c.value)}</span>
                        {c.source === 'ai' ? (
                          <span className="rounded-full bg-cyan-100 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-800">
                            ✨ AI {c.confidence != null ? `${Math.round(c.confidence * 100)}%` : ''}
                          </span>
                        ) : (
                          <span className="rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
                            User
                          </span>
                        )}
                        <span className="text-xs text-gray-400">by {c.org_name} · {c.created_at.slice(0, 10)}</span>
                        {c.source_url && <a href={c.source_url} target="_blank" rel="noreferrer" className="text-xs text-[#0E7490] hover:underline">source</a>}
                        {c.note && <span className="text-xs text-gray-500">— {c.note}</span>}
                        <input placeholder="Reviewer notes" value={notes[c.id] ?? ''} onChange={(e) => setNotes({ ...notes, [c.id]: e.target.value })}
                          className="ml-auto min-w-[160px] rounded border border-gray-200 px-2 py-1 text-xs" />
                        <Tooltip text="Marks this fact as confirmed true — verified facts are eligible for the shared catalog.">
                          <button onClick={() => review(c.id, 'verified')} className="rounded bg-green-700 px-2 py-1 text-xs font-medium text-white hover:bg-green-800">Verify</button>
                        </Tooltip>
                        <Tooltip text="Discards this submitted fact — it stays out of the catalog.">
                          <button onClick={() => review(c.id, 'rejected')} className="rounded border border-red-200 px-2 py-1 text-xs text-[#B00000] hover:bg-red-50">Reject</button>
                        </Tooltip>
                      </li>
                    ))}
                  </ul>
                </div>
              );})}
            </div>
          )}
          {held.length > 0 && (
            <div className="mt-3 rounded-lg border border-purple-200 bg-purple-50 p-2">
              <p className="mb-1.5 text-xs font-semibold text-purple-800">Held — needs a decision ({held.length})</p>
              <ul className="space-y-1.5 text-xs">
                {held.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{c.subject_name} — {c.field}:</span> {String(c.value)}
                    {c.source_url && <a href={c.source_url} target="_blank" rel="noreferrer" className="text-xs text-[#0E7490] hover:underline">source</a>}
                    {c.reviewer_notes && <span className="text-gray-500">— {c.reviewer_notes}</span>}
                    <input placeholder="Reviewer notes" value={notes[c.id] ?? ''} onChange={(e) => setNotes({ ...notes, [c.id]: e.target.value })}
                      className="ml-auto min-w-[160px] rounded border border-gray-200 px-2 py-1 text-xs" />
                    <button onClick={() => review(c.id, 'verified')} className="rounded bg-green-700 px-2 py-1 text-xs font-medium text-white hover:bg-green-800">Verify</button>
                    <button onClick={() => review(c.id, 'rejected')} className="rounded border border-red-200 px-2 py-1 text-xs text-[#B00000] hover:bg-red-50">Reject</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {reviewed.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-gray-400">Decided ({reviewed.length})</summary>
              <ul className="mt-2 space-y-1 text-xs">
                {reviewed.map((c) => (
                  <li key={c.id} className="flex items-center gap-2">
                    <span className={`rounded-full px-1.5 py-0.5 font-semibold ${c.status === 'verified' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{c.status}</span>
                    <span>{c.subject_name} — {c.field}: {String(c.value)}</span>
                    <span className="text-gray-400">by {c.org_name}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </Card>
  );
}

type ConsensusItem = {
  id: string; catalogName: string; field: string; value: unknown; score: number;
  sourceCount: number; visibility: 'pending' | 'community' | 'verified' | 'hidden'; createdAt: string;
};

// Prompt 266 §6 — separate review surface from ContributionsTab above:
// that one is a single org's edit vs. the record on file; this one is two
// DIFFERENT orgs independently landing on the same still-blank field
// (catalog_field_consensus, populated by /api/community-consensus/register
// — see community-consensus.ts). 'pending' rows are the backlog (1 source
// awaiting a second, or 2+ that never matched even after the AI arbiter);
// 'hidden' rows had their score voted/rejected to <=0 and get their own
// un-hide affordance rather than living in the same list; 'community'/
// 'verified' rows are already visible to founders and shown read-only,
// for audit only.
function ContributionsByUsersTab() {
  const confirm = useConfirm();
  const [items, setItems] = useState<ConsensusItem[] | null>(null);
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  function refresh() {
    fetch('/api/backoffice/community-consensus').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setItems(body.items);
    });
  }
  useEffect(refresh, []);

  async function review(id: string, decision: 'approve' | 'reject') {
    setBusyId(id);
    try {
      await fetch(`/api/backoffice/community-consensus/${id}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }),
      });
      refresh();
    } finally {
      setBusyId(null);
    }
  }

  // Same "bulk is a UI convenience only" principle as ContributionsTab's
  // own bulkReview — every id still goes through the single-item route.
  async function bulkApprove(ids: string[]) {
    setBulkBusy(true);
    try {
      await Promise.all(ids.map((id) => fetch(`/api/backoffice/community-consensus/${id}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'approve' }),
      })));
    } finally {
      setBulkBusy(false);
      refresh();
    }
  }

  if (err) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!items) return <p className="text-sm text-gray-400">Loading…</p>;

  const pending = items.filter((i) => i.visibility === 'pending');
  const hidden = items.filter((i) => i.visibility === 'hidden');
  const visible = items.filter((i) => i.visibility === 'community' || i.visibility === 'verified');
  // Prompt 266 §6 — global bulk-approval threshold for this tab: rows that
  // already reached 2+ independently agreeing... well, at least
  // independently REPORTING orgs (a disagreement the AI arbiter couldn't
  // resolve still counts — a human bulk-approving it is exactly the
  // override this button is for). A single-source row never qualifies for
  // the bulk button — with nothing to corroborate it, it stays a one-by-
  // one call, same as the prompt's own "for manual developer approve/
  // reject without waiting for a 2nd org" phrasing implies for that case.
  const concordant = pending.filter((i) => i.sourceCount >= 2);

  async function confirmBulk() {
    if (!(await confirm({ message: `Approve ${concordant.length} field${concordant.length === 1 ? '' : 's'} with 2+ independently reporting orgs?` }))) return;
    bulkApprove(concordant.map((i) => i.id));
  }

  return (
    <Card title={`Contributions — by users (${pending.length})`}>
      <p className="mb-3 text-xs text-gray-500">
        Two orgs, each in their own private CRM, independently filled the same still-blank field for the same
        investor. Approve makes it visible to every founder as &quot;community · unconfirmed&quot;; reject hides
        it — nothing here is ever deleted, only scored. A single source is included too, for a call you don&apos;t
        want to wait on a second org for.
      </p>
      {concordant.length > 0 && (
        <div className="mb-3">
          <button disabled={bulkBusy} onClick={confirmBulk}
            className="rounded-lg border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-medium text-green-800 hover:bg-green-100 disabled:opacity-40">
            {bulkBusy ? 'Working…' : `Approve all ≥2 concordant orgs (${concordant.length})`}
          </button>
        </div>
      )}
      {pending.length === 0 ? <p className="text-sm text-gray-400">Queue clear.</p> : (
        <ul className="space-y-2">
          {pending.map((c) => (
            <li key={c.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{c.catalogName}</span>
                <span className="text-xs text-gray-400">{fieldLabel(c.field)}</span>
                <span className="rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
                  {c.sourceCount} org{c.sourceCount === 1 ? '' : 's'}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-gray-600">{formatFieldValue(c.value)}</p>
              <div className="mt-1.5 flex gap-1.5">
                <button disabled={busyId === c.id} onClick={() => review(c.id, 'approve')}
                  className="rounded bg-green-700 px-2 py-1 text-xs font-medium text-white hover:bg-green-800 disabled:opacity-40">Approve</button>
                <button disabled={busyId === c.id} onClick={() => review(c.id, 'reject')}
                  className="rounded border border-red-200 px-2 py-1 text-xs text-[#B00000] hover:bg-red-50 disabled:opacity-40">Reject</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {hidden.length > 0 && (
        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-2">
          <p className="mb-1.5 text-xs font-semibold text-gray-500">Hidden — score at or below 0 ({hidden.length})</p>
          <ul className="space-y-1.5 text-xs">
            {hidden.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{c.catalogName} — {fieldLabel(c.field)}:</span> {formatFieldValue(c.value)}
                <span className="text-gray-400">score {c.score}, {c.sourceCount} org{c.sourceCount === 1 ? '' : 's'}</span>
                <button disabled={busyId === c.id} onClick={() => review(c.id, 'approve')}
                  className="ml-auto rounded bg-green-700 px-2 py-0.5 text-xs font-medium text-white hover:bg-green-800 disabled:opacity-40">Un-hide</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {visible.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-gray-400">Visible to founders ({visible.length})</summary>
          <ul className="mt-2 space-y-1 text-xs">
            {visible.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <span className={`rounded-full px-1.5 py-0.5 font-semibold ${c.visibility === 'verified' ? 'bg-green-50 text-green-700' : 'bg-cyan-50 text-cyan-800'}`}>{c.visibility}</span>
                <span>{c.catalogName} — {fieldLabel(c.field)}: {formatFieldValue(c.value)}</span>
                <span className="text-gray-400">score {c.score}, {c.sourceCount} org{c.sourceCount === 1 ? '' : 's'}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

type Claim = {
  id: string; person_id: string | null; claimant_email: string; match_score: number | null;
  status: 'pending' | 'approved' | 'rejected'; created_at: string; resolved_at: string | null;
  personName: string | null; orgName: string | null;
};

function ClaimsTab() {
  const [items, setItems] = useState<Claim[] | null>(null);
  const [err, setErr] = useState('');

  function refresh() {
    fetch('/api/backoffice/claims').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setItems(body.claims);
    });
  }
  useEffect(refresh, []);

  async function resolve(id: string, decision: 'approved' | 'rejected') {
    await fetch(`/api/backoffice/claims/${id}/resolve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }),
    });
    refresh();
  }

  if (err) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!items) return <p className="text-sm text-gray-400">Loading…</p>;
  const pending = items.filter((c) => c.status === 'pending');
  const decided = items.filter((c) => c.status !== 'pending');

  return (
    <Card title={`Profile claims (${pending.length})`}>
      <p className="mb-3 text-xs text-gray-500">
        LinkedIn self-claim (IRM_SPEC §5) — empty until LinkedIn OAuth is configured. Match score is the overlap between
        the LinkedIn account and the record shown to startups; only a high score should be approved.
      </p>
      {pending.length === 0 ? <p className="text-sm text-gray-400">Queue clear.</p> : (
        <ul className="space-y-2">
          {pending.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 p-3 text-sm">
              <span className="font-medium">{c.claimant_email}</span>
              {c.personName && <span className="text-xs text-gray-500">→ {c.personName} ({c.orgName})</span>}
              {c.match_score != null && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${c.match_score >= 0.95 ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                  match {Math.round(c.match_score * 100)}%
                </span>
              )}
              <div className="ml-auto flex gap-2">
                <Tooltip text="Confirms this LinkedIn account is the same person as the record — grants them self-claim access.">
                  <button onClick={() => resolve(c.id, 'approved')} className="rounded bg-green-700 px-2 py-1 text-xs font-medium text-white hover:bg-green-800">Approve</button>
                </Tooltip>
                <Tooltip text="Declines the claim — the match score or evidence wasn't convincing enough.">
                  <button onClick={() => resolve(c.id, 'rejected')} className="rounded border border-red-200 px-2 py-1 text-xs text-[#B00000] hover:bg-red-50">Reject</button>
                </Tooltip>
              </div>
            </li>
          ))}
        </ul>
      )}
      {decided.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-gray-400">Decided ({decided.length})</summary>
          <ul className="mt-2 space-y-1 text-xs">
            {decided.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <span className={`rounded-full px-1.5 py-0.5 font-semibold ${c.status === 'approved' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{c.status}</span>
                <span>{c.claimant_email}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

type GdprRequest = {
  id: string; person_id: string | null; claimant_name: string | null; claimant_email: string;
  kind: 'rectify' | 'erase'; details: string | null; status: 'pending' | 'resolved' | 'rejected';
  created_at: string; resolved_at: string | null;
  daysLeft: number; overdue: boolean; dueLabel: string;
  namedPerson: { id: string; name: string; orgName: string; entityName: string | null } | null;
  requesterEmailMatchesRecord: boolean | null;
  resolvedByEmail: string | null; reviewer_notes: string | null; resolution_method: string | null;
  removal_summary: { people_rows: number; orgs_affected: number; erased_at?: string } | null;
  matches: { personId: string; name: string; orgName: string }[];
};

function GdprTab() {
  const showResolvedParam = useSearchParams().get('resolved') === 'show';
  const [items, setItems] = useState<GdprRequest[] | null>(null);
  const [err, setErr] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<Record<string, string>>({});
  const [rectifyNotes, setRectifyNotes] = useState('');

  function refresh() {
    fetch('/api/backoffice/gdpr').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setItems(body.requests);
    });
  }
  useEffect(refresh, []);

  async function act(row: GdprRequest, action: 'rectify' | 'erase' | 'reject', payload: Record<string, string>) {
    setBusyId(row.id);
    const res = await fetch(`/api/backoffice/gdpr/${row.id}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await res.json();
    setBusyId(null);
    if (body.ok === false) { setActionErr((prev) => ({ ...prev, [row.id]: body.error })); return; }
    setSelectedId(null); setRectifyNotes('');
    refresh();
  }

  if (err) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!items) return <p className="text-sm text-gray-400">Loading…</p>;
  const pending = items.filter((r) => r.status === 'pending');
  const overdueCount = pending.filter((r) => r.overdue || r.daysLeft <= 7).length;

  const columns: QueueColumn<GdprRequest>[] = [
    { key: 'kind', label: 'Kind', render: (r) => (
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${r.kind === 'erase' ? 'bg-red-100 text-red-800' : 'bg-cyan-100 text-cyan-800'}`}>{r.kind}</span>
    ) },
    { key: 'claimant', label: 'Requester', render: (r) => (
        <div><div className="font-medium">{r.claimant_name || r.claimant_email}</div><div className="text-xs font-normal text-gray-400">{r.claimant_email}</div></div>
    ) },
    { key: 'when', label: 'Submitted', sortable: true, render: (r) => <span className="text-gray-500">{new Date(r.created_at).toLocaleDateString()}</span> },
    { key: 'due', label: 'Due', render: (r) => r.status !== 'pending'
        ? <span className="text-xs text-gray-300">—</span>
        : <span className={r.overdue || r.daysLeft <= 7 ? 'font-semibold text-[#B00000]' : r.daysLeft <= 14 ? 'font-semibold text-amber-600' : 'text-gray-400'}>{r.dueLabel}</span> },
    { key: 'status', label: '', render: (r) => r.status !== 'pending'
        ? <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${r.status === 'resolved' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{r.status}</span>
        : null },
  ];

  return (
    <div className="space-y-4">
      <Card title={`GDPR / RGPD requests (${pending.length})`} tint={overdueCount > 0 ? 'red' : undefined}>
        <p className="mb-3 text-xs text-gray-500">
          The only queue with a legal deadline — 30 days from submission, nearest first. &quot;Erase&quot; nulls PII on
          every matched people row across every org (never deletes the row — every other table that references it
          stays valid); the correction for Rectify happens in the founder&apos;s own People record.
        </p>
        <ReviewQueueLayout<GdprRequest>
          columns={columns}
          rows={showResolvedParam ? items : pending}
          total={pending.length}
          getRowId={(r) => r.id}
          emptyMessage="Queue clear."
          selectedId={selectedId}
          onSelect={setSelectedId}
          panelTitle={(r) => r.claimant_name || r.claimant_email}
          renderPanel={(row) => (
            <div className="space-y-4">
              {actionErr[row.id] && <p className="text-xs text-[#B00000]">{actionErr[row.id]}</p>}
              <ReviewFacts
                what={<>{row.kind === 'erase' ? 'Erase' : 'Rectify'} request{row.details && <> — {row.details}</>}</>}
                whoFrom={<>{row.claimant_name || '(no name given)'} · {row.claimant_email} · submitted {new Date(row.created_at).toLocaleDateString()}</>}
                proof={
                  <>
                    {row.namedPerson ? (
                      <>Named record: <b>{row.namedPerson.name}</b> at {row.namedPerson.orgName}{row.namedPerson.entityName ? ` (${row.namedPerson.entityName})` : ''}
                        {' — '}{row.requesterEmailMatchesRecord ? <span className="text-green-700">requester email matches ✓</span> : <span className="text-[#B00000]">requester email does not match ✗</span>}</>
                    ) : 'No specific record named — matched only by email below.'}
                    <div className="mt-1">
                      {row.matches.length === 0 ? 'No people row currently matches this email in any org.' : (
                        <>Affected orgs: {[...new Set(row.matches.map((m) => m.orgName))].join(', ')} ({row.matches.length} record{row.matches.length === 1 ? '' : 's'})</>
                      )}
                    </div>
                  </>
                }
                thenWhat={row.status !== 'pending' ? undefined : row.kind === 'erase'
                  ? `Erasing nulls name/email/phone/LinkedIn on all ${row.matches.length} matched record(s) and marks them do-not-contact. Interaction history stays (it's the founder's own correspondence record), but no longer names this person.`
                  : 'Marking resolved records that the correction was made — the actual field edit happens in the founder\'s own People screen.'}
              />
              {row.status !== 'pending' ? (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600">
                  <div><dt className="text-gray-400">Resolved by</dt><dd>{row.resolvedByEmail ?? 'Unknown'}</dd></div>
                  <div><dt className="text-gray-400">Resolved at</dt><dd>{row.resolved_at ? new Date(row.resolved_at).toLocaleString() : '—'}</dd></div>
                  {row.resolution_method && <div><dt className="text-gray-400">Method</dt><dd>{row.resolution_method}</dd></div>}
                  {row.reviewer_notes && <div className="col-span-2"><dt className="text-gray-400">Notes</dt><dd>{row.reviewer_notes}</dd></div>}
                  {row.removal_summary && (
                    <div className="col-span-2"><dt className="text-gray-400">Removed</dt>
                      <dd>{row.removal_summary.people_rows} record(s) across {row.removal_summary.orgs_affected} org(s) — PII nulled, not the rows themselves.</dd>
                    </div>
                  )}
                </dl>
              ) : row.kind === 'rectify' ? (
                <>
                  <textarea value={rectifyNotes} onChange={(e) => setRectifyNotes(e.target.value)} rows={2}
                    placeholder="What was corrected, and where (optional)"
                    className="w-full rounded-lg border border-gray-300 p-2 text-xs" />
                  <ReviewActionFooter
                    busy={busyId === row.id}
                    onApprove={() => act(row, 'rectify', { notes: rectifyNotes })}
                    approveLabel="Mark resolved"
                    onReject={(reason) => act(row, 'reject', { reason })}
                  />
                </>
              ) : (
                // Erase gets the red-toned slot (ReviewActionFooter's
                // onReject styling) — it's the one genuinely irreversible
                // action in this whole panel; rejecting the REQUEST itself
                // (declining to act) is the lower-stakes one and sits on
                // the neutral onDismiss slot instead.
                <ReviewActionFooter
                  busy={busyId === row.id}
                  onReject={(reason) => act(row, 'erase', { reason })}
                  rejectLabel="Erase"
                  onDismiss={(reason) => act(row, 'reject', { reason })}
                  dismissLabel="Reject request"
                />
              )}
            </div>
          )}
        />
      </Card>
    </div>
  );
}

// Prompt 574 §B — Suspicious accounts (developer-flagged, Prompt 244/245)
// and Fraud reports (founder-submitted, Prompt 277 A.3) share one tab with
// a source filter now, rather than two separate top-level tabs. Kept as a
// thin wrapper around the existing SuspiciousAccountsTab/FraudFlagsTab
// content — NOT rebuilt onto ReviewQueueLayout's row+panel shape: both
// already carry real, working, non-trivial UI of their own (evidence refs
// and a repeatable action history for one; a cross-org confirmation
// threshold and founder disputes for the other) that doesn't reduce to a
// single-row-select-then-decide panel without a real redesign this prompt
// didn't scope. SuspiciousFlagActions.tsx itself DID migrate to
// AccountActionPanel (§B.3's own explicit instruction) — see that file.
type TrustSafetySource = 'all' | 'suspicious' | 'fraud';

function TrustSafetyTab() {
  const urlSource = useSearchParams().get('source');
  const [source, setSource] = useState<TrustSafetySource>(urlSource === 'suspicious' || urlSource === 'fraud' ? urlSource : 'all');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5 text-xs">
        {(['all', 'suspicious', 'fraud'] as const).map((s) => (
          <button key={s} onClick={() => setSource(s)}
            className={`rounded-full px-2.5 py-1 font-medium ${source === s ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {s === 'all' ? 'All' : s === 'suspicious' ? 'Suspicious accounts' : 'Fraud reports'}
          </button>
        ))}
      </div>
      {(source === 'all' || source === 'suspicious') && <SuspiciousAccountsTab />}
      {(source === 'all' || source === 'fraud') && <FraudFlagsTab />}
    </div>
  );
}

// Prompt 573 §C — one queue for the three things that verify an investor's
// identity: a self-declared new firm (Bloco 1), an uploaded document
// (Bloco 3), or a claim on an EXISTING catalog firm (investor_entity_claims
// — previously counted (queue-summary's investor_claims) but never
// rendered anywhere; Phase 1 of Prompt 576 even folded its count into "New
// investors" as an explicit stated placeholder, corrected here and in
// BackofficeShell to live under Investor identity instead, where it
// actually belongs). "Domain mismatch" is a filter chip on this same queue
// now, not its own tab — see the redirect above and DomainMismatchTab.tsx,
// reused as-is rather than merged row-for-row (its own review unit is "fix
// a field on an entities row", structurally different from "approve/reject
// a verification decision").
type IdentityFilter = 'all' | 'self_declared' | 'document' | 'claim' | 'domain_mismatch';

function InvestorIdentityTab() {
  // QueueTable's own "Show resolved"/"Hide internal" checkboxes write
  // ?resolved=show / ?internal=shown to the URL (queue-table-state.ts's own
  // param names) regardless of which tab renders them; reading them back
  // here is what makes those checkboxes actually do something for this
  // queue — rows are fetched all at once, so there's no server round-trip
  // to gate on instead.
  const searchParams = useSearchParams();
  const showResolvedParam = searchParams.get('resolved') === 'show';
  const hideInternalParam = searchParams.get('internal') !== 'shown';
  const [rows, setRows] = useState<UnifiedIdentityRow[] | null>(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<IdentityFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<Record<string, string>>({});
  const [mx, setMx] = useState<Record<string, MxLookupResult>>({});

  function refresh() {
    fetch('/api/backoffice/investor-identity').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setRows(body.rows ?? []);
    });
  }
  useEffect(refresh, []);

  async function lookupMx(domain: string | null) {
    if (!domain || mx[domain]) return;
    const res = await fetch('/api/backoffice/investor-identity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ domain }) });
    const body = await res.json();
    if (body.ok) setMx((prev) => ({ ...prev, [domain]: body.result }));
  }

  const reviewUrl = (row: UnifiedIdentityRow) =>
    row.kind === 'self_declared' ? `/api/backoffice/investor-identity/entities/${row.entityId}/review`
    : row.kind === 'document' ? `/api/backoffice/investor-identity/documents/${row.id}/review`
    : null;

  async function approve(row: UnifiedIdentityRow, method: 'domain' | 'document' | 'manual') {
    setBusyId(row.id);
    const url = row.kind === 'claim' ? `/api/backoffice/investor-entity-claims/${row.id}/approve` : reviewUrl(row)!;
    const payload = row.kind === 'claim' ? { method } : { decision: 'approved' };
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await res.json();
    setBusyId(null);
    if (body.ok === false) { setActionErr((prev) => ({ ...prev, [row.id]: body.error })); return; }
    setSelectedId(null);
    refresh();
  }
  async function reject(row: UnifiedIdentityRow, reason: string) {
    setBusyId(row.id);
    const url = row.kind === 'claim' ? `/api/backoffice/investor-entity-claims/${row.id}/reject` : reviewUrl(row)!;
    const payload = row.kind === 'claim' ? { reason } : { decision: 'rejected', reason, notes: reason };
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await res.json();
    setBusyId(null);
    if (body.ok === false) { setActionErr((prev) => ({ ...prev, [row.id]: body.error })); return; }
    setSelectedId(null);
    refresh();
  }
  // Prompt 573 §C — "Link to existing catalog firm": the probable match is
  // a candidate catalog_entities row, so this is exactly what
  // /api/backoffice/catalog/merge already does for two catalog_entities ids
  // (Prompt 580 hardened it — inversion guard, alias-preserving, reference
  // repointing) — reused as-is rather than building a second merge path.
  async function linkToExisting(row: UnifiedIdentityRow, reason: string) {
    if (!row.probableCatalogMatch) return;
    setBusyId(row.id);
    const res = await fetch('/api/backoffice/catalog/merge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keepId: row.probableCatalogMatch.id, mergeIds: [row.entityId], reason }),
    });
    const body = await res.json();
    setBusyId(null);
    if (body.ok === false) { setActionErr((prev) => ({ ...prev, [row.id]: body.error })); return; }
    setSelectedId(null);
    refresh();
  }

  if (err) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!rows) return <p className="text-sm text-gray-400">Loading…</p>;

  const pending = rows.filter((r) => r.status === 'pending');
  const pendingVisible = pending.filter((r) => !r.isInternal);
  const hiddenInternalCount = pending.filter((r) => r.isInternal).length;
  const statusScope = showResolvedParam ? rows : pending;
  const inScope = hideInternalParam ? statusScope.filter((r) => !r.isInternal || r.status !== 'pending') : statusScope;
  const counts = {
    self_declared: pendingVisible.filter((r) => r.kind === 'self_declared').length,
    document: pendingVisible.filter((r) => r.kind === 'document').length,
    claim: pendingVisible.filter((r) => r.kind === 'claim').length,
  };
  const filtered = filter === 'all' || filter === 'domain_mismatch' ? inScope : inScope.filter((r) => r.kind === filter);

  const columns: QueueColumn<UnifiedIdentityRow>[] = [
    { key: 'entity', label: 'Investor', sortable: true, render: (r) => (
        <div><div className="font-medium">{r.entityName}</div>{r.entityWebsite && <div className="text-xs font-normal text-gray-400">{r.entityWebsite}</div>}</div>
    ) },
    { key: 'origin', label: 'Origin', render: (r) => (
        <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
          {r.kind === 'self_declared' ? 'self-declared firm' : r.kind === 'document' ? 'document' : 'claim on existing firm'}
        </span>
    ) },
    { key: 'requester', label: 'Requester', render: (r) => <span className="text-gray-500">{r.requesterEmail}</span> },
    { key: 'when', label: 'Added when', sortable: true, render: (r) => <span className="text-gray-500">{new Date(r.createdAt).toLocaleDateString()}</span> },
    { key: 'domain', label: 'Domain match', render: (r) => r.domainMatch == null
        ? <span className="text-xs text-gray-300" title="No website declared — domain check impossible">—</span>
        : r.domainMatch ? <span className="text-green-600">✓</span> : <span className="text-[#B00000]">✗</span> },
    { key: 'status', label: '', render: (r) => (
        <span className="flex gap-1">
          {r.isDispute && <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">disputed</span>}
          {r.status === 'resolved' && <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">resolved</span>}
        </span>
    ) },
  ];

  return (
    <div className="space-y-4">
      <Card title={`Investor identity (${counts.self_declared + counts.document + counts.claim})`}>
        <p className="mb-3 text-xs text-gray-500">
          Three ways an investor&apos;s identity gets verified — a firm they self-declared, an uploaded document, or a
          claim on a firm already in the catalog — one queue, one panel. Domain mismatch is a filter here now, not
          its own tab: fixing a field on an existing catalog row is a different action from approving a request.
        </p>
        <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
          {([
            ['all', `All (${counts.self_declared + counts.document + counts.claim})`],
            ['self_declared', `Self-declared (${counts.self_declared})`],
            ['document', `Documents (${counts.document})`],
            ['claim', `Claims (${counts.claim})`],
            ['domain_mismatch', 'Domain mismatch'],
          ] as [IdentityFilter, string][]).map(([f, label]) => (
            <button key={f} onClick={() => { setFilter(f); setSelectedId(null); }}
              className={`rounded-full px-2.5 py-1 font-medium ${filter === f ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {label}
            </button>
          ))}
        </div>

        {filter === 'domain_mismatch' ? <DomainMismatchTab /> : (
          <ReviewQueueLayout<UnifiedIdentityRow>
            columns={columns}
            rows={filtered}
            total={filtered.length}
            getRowId={(r) => r.id}
            hiddenInternalCount={hiddenInternalCount}
            emptyMessage="Nothing left to review here."
            selectedId={selectedId}
            onSelect={(id) => { setSelectedId(id); const row = rows.find((r) => r.id === id); if (row?.claimantDomain) void lookupMx(row.claimantDomain); if (row?.entityDomain) void lookupMx(row.entityDomain); }}
            panelTitle={(r) => r.entityName}
            renderPanel={(row) => {
              const claimantMx = row.claimantDomain ? mx[row.claimantDomain] : undefined;
              const entityMx = row.entityDomain ? mx[row.entityDomain] : undefined;
              const kindLabel = row.kind === 'self_declared' ? 'self-declared firm' : row.kind === 'document' ? 'uploaded document' : 'claim on existing firm';
              const documentClean = row.kind === 'document' && row.malwareScanStatus === 'clean';
              return (
                <div className="space-y-4">
                  {actionErr[row.id] && <p className="text-xs text-[#B00000]">{actionErr[row.id]}</p>}
                  {row.isInternal && <p className="text-xs text-gray-400">Internal / QA account — shown because &quot;Hide internal&quot; is off.</p>}
                  <ReviewFacts
                    what={<>{row.entityName}{row.entityWebsite && <> — <a href={row.entityWebsite.startsWith('http') ? row.entityWebsite : `https://${row.entityWebsite}`} target="_blank" rel="noreferrer" className="text-[#0E7490] hover:underline">{row.entityWebsite}</a></>}</>}
                    whoFrom={<>{row.requesterEmail} · {kindLabel} · {new Date(row.createdAt).toLocaleDateString()}</>}
                    proof={
                      <>
                        {row.entityWebsite == null ? (
                          <>No website declared — domain check impossible.</>
                        ) : row.domainMatch ? (
                          <>Requester domain <b>{row.claimantDomain}</b> matches the firm&apos;s own domain (<b>{row.entityDomain}</b>).</>
                        ) : (
                          <>Requester domain <b>{row.claimantDomain ?? '—'}</b> does not match the firm&apos;s domain (<b>{row.entityDomain ?? '—'}</b>).</>
                        )}
                        {claimantMx && <div className="mt-1 text-xs text-gray-500">MX on {row.claimantDomain}: {claimantMx.checked ? (claimantMx.hasMx ? 'configured' : 'no mail servers found') : `couldn't check (${claimantMx.reason})`}</div>}
                        {entityMx && <div className="text-xs text-gray-500">MX on {row.entityDomain}: {entityMx.checked ? (entityMx.hasMx ? 'configured' : 'no mail servers found') : `couldn't check (${entityMx.reason})`}</div>}
                        {row.kind === 'document' && (
                          <div className="mt-1">
                            {row.documentUrl ? <a href={row.documentUrl} target="_blank" rel="noreferrer" className="text-[#0E7490] hover:underline">{row.documentFileName}</a> : <span>{row.documentFileName}</span>}
                            <span className="ml-1.5 text-xs text-gray-400">({row.malwareScanStatus ?? 'not scanned'})</span>
                            {row.malwareFlagged && <span className="ml-1.5 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-[#B00000]">⚠ flagged as malware</span>}
                          </div>
                        )}
                        {row.kind !== 'document' && row.documentCount > 0 && <div className="mt-1 text-xs text-gray-500">{row.documentCount} verification document{row.documentCount === 1 ? '' : 's'} also on file for this firm.</div>}
                        {row.isDispute && <div className="mt-1 text-amber-700">This firm already has an approved claimant — approving this one disputes it.</div>}
                      </>
                    }
                    thenWhat={row.status === 'resolved' ? undefined : row.kind === 'claim'
                      ? 'Approving makes this the verified owner of the catalog entity; every investor linked to it inherits the "Verified fund" badge.'
                      : 'Approving marks the catalog entity verified — every investor linked to it inherits the badge, not just this one.'}
                  />
                  {row.probableCatalogMatch && (
                    <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
                      Probable catalog match: <b>{row.probableCatalogMatch.name}</b>{row.probableCatalogMatch.website ? ` (${row.probableCatalogMatch.website})` : ''} — consider linking to this existing entity instead of verifying a new one.
                    </p>
                  )}
                  {row.status === 'resolved' ? (
                    // Prompt 573 §C — history: who resolved it, when, with
                    // what method, and (for claims) whether the decision
                    // notice actually reached the claimant.
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600">
                      <div><dt className="text-gray-400">Resolved by</dt><dd>{row.resolvedByEmail ?? 'Unknown'}</dd></div>
                      <div><dt className="text-gray-400">Resolved at</dt><dd>{row.resolvedAt ? new Date(row.resolvedAt).toLocaleString() : '—'}</dd></div>
                      {row.resolutionMethod && <div><dt className="text-gray-400">Method</dt><dd>{row.resolutionMethod}</dd></div>}
                      {row.resolutionNotes && <div className="col-span-2"><dt className="text-gray-400">Notes</dt><dd>{row.resolutionNotes}</dd></div>}
                      {row.notifyFailed && <div className="col-span-2 text-amber-700">The claimant&apos;s decision notice failed to send.</div>}
                    </dl>
                  ) : row.kind === 'claim' ? (
                    // §C's own action list names exactly one verify button
                    // for a claim — "Verify (domain) — só activa quando
                    // domain_match=true" — disabled, not hidden, when false.
                    <ReviewActionFooter
                      busy={busyId === row.id}
                      onApprove={() => approve(row, 'domain')}
                      approveLabel="Verify (domain)"
                      approveDisabled={row.domainMatch !== true}
                      onReject={(reason) => reject(row, reason)}
                    />
                  ) : (() => {
                    // self_declared/document share the same verify rule:
                    // domain match wins when present (§C's own "Verify
                    // (domain)"), a document falls back to "Verify
                    // (document)" gated on a clean scan, anything else has
                    // no other evidence to gate on and stays a plain manual
                    // call — never disabled, since refusing to let an admin
                    // approve a self-declared firm with no evidence at all
                    // would be a dead end, not a safeguard.
                    //
                    // A document-kind row is ALWAYS "Verify (document)",
                    // gated on a clean scan, even when it also happens to
                    // have a domain match — a domain match is corroborating
                    // context in the PROOF text above, never a side door
                    // around "só com documento clean" for the one kind that
                    // actually carries a file to scan.
                    const method: 'domain' | 'document' | 'manual' = row.kind === 'document' ? 'document' : row.domainMatch ? 'domain' : 'manual';
                    const approveLabel = method === 'domain' ? 'Verify (domain)' : method === 'document' ? 'Verify (document)' : 'Verify (manual)';
                    const approveDisabled = method === 'document' && !documentClean;
                    return (
                      <ReviewActionFooter
                        busy={busyId === row.id}
                        onApprove={() => approve(row, method)}
                        approveLabel={approveLabel}
                        approveDisabled={approveDisabled}
                        onDismiss={row.probableCatalogMatch ? (reason) => linkToExisting(row, reason) : undefined}
                        dismissLabel="Link to existing catalog firm"
                        onReject={(reason) => reject(row, reason)}
                      />
                    );
                  })()}
                </div>
              );
            }}
          />
        )}
      </Card>
    </div>
  );
}

// ---- Catalog candidates tab (Prompt 187 §A/§D, moved here by Prompt 190) ----
// Moved verbatim from backoffice/catalog/page.tsx — types/helpers duplicated
// rather than shared, since they're small, pure, and this keeps the two
// pages independent (catalog/page.tsx still needs its own copies for
// CatalogTable/MergeDuplicatesTool, which stayed there).

type CatalogContactRow = {
  id: string; fullName: string; linkedinUrl: string | null; hookStatus: string;
  doNotContact: boolean; title: string | null; isPrimary: boolean;
};

type CatalogEntity = {
  id: string; name: string; type: string; hq_city: string | null; hq_country: string | null;
  sectors: string[]; website: string | null; verification_status: 'verified' | 'pending' | 'rejected';
  verified_at: string | null; source: string; notes: string | null; aliases: string[];
  stage_min: string | null; stage_max: string | null; check_min_eur: number | null; check_max_eur: number | null;
  geographies: string[] | null; contacts: CatalogContactRow[];
};

function fmtCheck(min: number | null, max: number | null) {
  if (!min && !max) return '—';
  const f = (n: number) => n >= 1_000_000 ? `€${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M` : `€${Math.round(n / 1000)}k`;
  if (min && max) return `${f(min)}–${f(max)}`;
  return f((min ?? max)!);
}
function fmtStage(min: string | null, max: string | null) {
  if (!min && !max) return '—';
  if (min && max && min !== max) return `${min}–${max}`;
  return min ?? max ?? '—';
}

type EnrichmentRow = {
  subjectType: 'entity' | 'person'; name: string; orgCount: number; activeCount: number;
  requestCount: number; minPercent: number; missing: string[]; demand: number;
  // Prompt 594 §D — the catalog row behind this name-grouped queue entry,
  // when one is linked. null for the unlinked majority, and then the name
  // stays plain text rather than becoming a link to nowhere.
  catalogId: string | null;
};
type ResearchProposal = { field: string; value: string; confidence: number; source_url: string };
// Prompt 594 §B/§C + 595 §E — distinctOrgCount replaces the old
// appliedToOrgs (which counted matching ROWS and called them orgs, so two
// person rows in one org read as "2 org(s)"); appliedTo carries the
// per-row detail the popup needs, including anything withheld because the
// row's own firm didn't match the one the research actually found.
type ResearchAppliedTo = {
  rowId: string; orgId: string; orgName: string; firmName: string | null;
  appliedFields: string[]; withheldFields: string[];
};
type ResearchResult = {
  status: 'loading' | 'not_configured' | 'error' | 'done';
  message?: string;
  subjectName?: string;
  proposals?: ResearchProposal[];
  distinctOrgCount?: number;
  appliedTo?: ResearchAppliedTo[];
};

// Prompt 595 §E — "não faço ideia do que faz; no fim... podia abrir popup
// simples a indicar o que de novo foi obtido". The engine already stored
// field/value/source; this is the missing half — showing it, with a way
// through to where the proposals are actually waiting. Portal-rendered per
// this repo's own overlay rule (WorkspaceHeader's backdrop-blur is exactly
// the ancestor that silently collapses a plain fixed overlay).
function ResearchResultModal({ result, onClose, onOpenContributions }: {
  result: ResearchResult & { subjectName: string }; onClose: () => void; onOpenContributions: () => void;
}) {
  if (typeof document === 'undefined') return null;
  const withheld = (result.appliedTo ?? []).filter((a) => a.withheldFields.length > 0);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[10vh]" onClick={onClose}>
      <div className="max-h-[75vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline justify-between border-b border-gray-100 px-5 py-3.5">
          <h3 className="text-sm font-bold text-gray-900">Research results — {result.subjectName}</h3>
          <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600">Close</button>
        </div>
        <div className="space-y-3 px-5 py-4">
          {(result.proposals ?? []).length === 0 ? (
            <p className="text-sm text-gray-500">{result.message ?? 'No confident findings.'}</p>
          ) : (
            <>
              <p className="text-xs text-gray-500">
                {result.proposals!.length} field{result.proposals!.length === 1 ? '' : 's'} proposed, queued for verification
                {' '}across {result.distinctOrgCount} org{result.distinctOrgCount === 1 ? '' : 's'}. Nothing is live until it&apos;s approved.
              </p>
              <dl className="space-y-2.5">
                {result.proposals!.map((p) => (
                  <div key={p.field} className="rounded-lg border border-gray-100 p-2.5">
                    <dt className="flex items-baseline justify-between gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{fieldLabel(p.field)}</span>
                      <span className="text-[10px] text-gray-400">confidence {Math.round(p.confidence * 100)}%</span>
                    </dt>
                    <dd className="mt-1 whitespace-pre-wrap break-words text-[13px] text-gray-800">{p.value}</dd>
                    {p.source_url && (
                      <dd className="mt-1 truncate text-[11px]">
                        <a href={p.source_url} target="_blank" rel="noreferrer" className="text-[#0E7490] hover:underline">{p.source_url}</a>
                      </dd>
                    )}
                  </div>
                ))}
              </dl>
              {/* Prompt 594 §C — the withholding is stated, never silent. */}
              {withheld.length > 0 && (
                <div className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800">
                  <p className="font-medium">Some fields were not proposed everywhere.</p>
                  <p className="mt-1">
                    This name also matches {withheld.length} row{withheld.length === 1 ? '' : 's'} on a different firm. Role/background/hook
                    describe one firm&apos;s affiliation, so they were withheld there rather than copied across:
                  </p>
                  <ul className="mt-1.5 space-y-0.5">
                    {withheld.map((a) => (
                      <li key={a.rowId}>· {a.firmName ?? 'unknown firm'} ({a.orgName}) — withheld: {a.withheldFields.join(', ')}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
          <button onClick={onClose} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">Close</button>
          {(result.proposals ?? []).length > 0 && (
            <button onClick={onOpenContributions}
              className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#0b5c73]">
              Review in Contributions →
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function EnrichmentQueueTable({ title, subtitle, emptyLabel, queue, research, onResearch, onShowResult }: {
  title: string; subtitle: string; emptyLabel: string; queue: EnrichmentRow[];
  research: Record<string, ResearchResult>; onResearch: (subjectType: 'entity' | 'person', name: string) => void;
  onShowResult: (key: string) => void;
}) {
  return (
    <Card title={`${title} (${queue.length})`}>
      <p className="mb-3 text-xs text-gray-500">{subtitle}</p>
      {queue.length === 0 ? <p className="text-sm text-gray-400">{emptyLabel}</p> : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400"><th className="py-1.5">Subject</th><th>Type</th><th>Demand</th><th>Worst</th><th>Missing</th><th></th></tr>
          </thead>
          <tbody>
            {queue.map((r) => {
              const key = `${r.subjectType}:${r.name}`;
              const rr = research[key];
              return (
                <tr key={key} className="border-t border-gray-50 align-top">
                  {/* Prompt 594 §D — the subject column was dead text on the
                      one list where you most want to open the record and fix
                      it. A person goes to the dossier Prompt 581 §C already
                      built (checked before writing a second one — it exists,
                      with affiliations, verification levels and the
                      quarantine decide buttons); an entity to the catalog
                      list filtered to it, since no per-entity route exists.
                      Both carry the origin so the dossier's back arrow
                      returns HERE (595 §B.2) instead of its hardcoded index.
                      No catalog link on file -> plain text, the honest
                      answer for the 1299 unlinked rows (595 §C). */}
                  <td className="py-2 font-medium">
                    {r.catalogId ? (
                      <Link
                        href={r.subjectType === 'person'
                          ? `/backoffice/catalog/people/${r.catalogId}?from=${encodeURIComponent('/backoffice/queue?tab=candidates')}&fromLabel=${encodeURIComponent('the quality queue')}`
                          : `/backoffice/catalog?q=${encodeURIComponent(r.name)}`}
                        className="text-[#0E7490] hover:underline"
                      >
                        {r.name}
                      </Link>
                    ) : (
                      <span title="No catalog record linked to this row yet — nothing to open.">{r.name}</span>
                    )}
                  </td>
                  <td className="text-gray-500">{r.subjectType}</td>
                  <td className="text-gray-600" title={`${r.activeCount} active org(s) · ${r.requestCount} explicit request(s)`}>{r.demand}</td>
                  <td className="text-gray-600">{r.minPercent}%</td>
                  <td className="text-xs text-gray-500">
                    {r.missing.join(', ')}
                    {rr && (
                      <div className="mt-1">
                        {rr.status === 'loading' && <span className="text-gray-400">Researching…</span>}
                        {rr.status === 'not_configured' && <span className="text-amber-700">{rr.message}</span>}
                        {rr.status === 'error' && <span className="text-[#B00000]">{rr.message}</span>}
                        {rr.status === 'done' && (rr.proposals && rr.proposals.length > 0
                          ? (
                            <button onClick={() => onShowResult(key)} className="text-left text-cyan-800 hover:underline">
                              {rr.proposals.length} field(s) proposed → queued for {rr.distinctOrgCount} org(s). See what was found →
                            </button>
                          )
                          : <span className="text-gray-400">{rr.message ?? 'No confident findings.'}</span>)}
                      </div>
                    )}
                  </td>
                  <td>
                    <button onClick={() => onResearch(r.subjectType, r.name)} disabled={rr?.status === 'loading'}
                      className="whitespace-nowrap rounded-lg border border-cyan-200 px-2 py-1 text-xs text-cyan-800 hover:bg-cyan-50 disabled:opacity-40">
                      ✨ Research with AI
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function QualityPanel() {
  // Two separate queues (DECISIONS.md, follow-up to cc11161): the
  // original profile queue (people + entities below the firmographic
  // threshold, unchanged calibration) and a new entity-only contact queue
  // using the actionable rule (firmographic already >=70%, zero contact
  // fields) — a raw percent cutoff on the contact score alone would flag
  // nearly the whole base, which isn't a usable signal.
  const [profileQueue, setProfileQueue] = useState<EnrichmentRow[] | null>(null);
  const [contactQueue, setContactQueue] = useState<EnrichmentRow[] | null>(null);
  const [err, setErr] = useState('');
  const [research, setResearch] = useState<Record<string, ResearchResult>>({});
  // Prompt 595 §E — which finished result the popup is showing. Opens
  // itself when a research call lands (that's the whole point: the run
  // used to end with a number and no way to see what it found), and can
  // be reopened afterwards from the row's own line.
  const [shownResultKey, setShownResultKey] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/backoffice/enrichment').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setProfileQueue(body.profileQueue);
      setContactQueue(body.contactQueue);
    });
  }, []);

  async function researchRow(subjectType: 'entity' | 'person', name: string) {
    const key = `${subjectType}:${name}`;
    setResearch((prev) => ({ ...prev, [key]: { status: 'loading', subjectName: name } }));
    try {
      const res = await fetch('/api/backoffice/research', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subjectType, name }) });
      const body = await res.json();
      if (body.configured === false) setResearch((prev) => ({ ...prev, [key]: { status: 'not_configured', message: body.message, subjectName: name } }));
      else if (body.ok === false) setResearch((prev) => ({ ...prev, [key]: { status: 'error', message: body.error, subjectName: name } }));
      else {
        setResearch((prev) => ({
          ...prev,
          [key]: {
            status: 'done', subjectName: name, proposals: body.proposals,
            distinctOrgCount: body.distinctOrgCount, appliedTo: body.appliedTo, message: body.message,
          },
        }));
        setShownResultKey(key);
      }
    } catch (e) {
      setResearch((prev) => ({ ...prev, [key]: { status: 'error', message: (e as Error).message, subjectName: name } }));
    }
  }

  if (err) return <Card title="Quality — enrichment queue"><p className="text-sm text-[#B00000]">{err}</p></Card>;
  if (!profileQueue || !contactQueue) return <Card title="Quality — enrichment queue"><p className="text-sm text-gray-400">Loading…</p></Card>;

  const shown = shownResultKey ? research[shownResultKey] : undefined;

  return (
    <div className="space-y-4">
      <EnrichmentQueueTable
        title="Quality — profiles below 70% (firmographic)"
        subtitle="Ranked by demand. &quot;Research with AI&quot; proposes fields with source + confidence, queued for verification in Queue → Contributions."
        emptyLabel="Nothing below the firmographic completeness threshold right now."
        queue={profileQueue} research={research} onResearch={researchRow} onShowResult={setShownResultKey}
      />
      <EnrichmentQueueTable
        title="Quality — contact gaps"
        subtitle="Entities already firmographically solid (≥70%) but with zero contact fields on file — the actionable follow-up list for the direct-research program."
        emptyLabel="No firmographically-qualified entity has zero contact data right now."
        queue={contactQueue} research={research} onResearch={researchRow} onShowResult={setShownResultKey}
      />
      {shown?.status === 'done' && (
        <ResearchResultModal
          result={{ ...shown, subjectName: shown.subjectName ?? '' }}
          onClose={() => setShownResultKey(null)}
          onOpenContributions={() => { setShownResultKey(null); router.push('/backoffice/queue?tab=contributions'); }}
        />
      )}
    </div>
  );
}

const STAGE_OPTIONS = ['pre_seed', 'seed', 'series_a', 'later'] as const;

type ManualEntityContact = { id: string; fullName: string; role: string | null; email: string | null; linkedinUrl: string | null; phone: string | null };

type ManualEntity = {
  id: string; orgId: string; orgName: string; name: string; website: string | null;
  hqCity: string | null; hqCountry: string | null; geographies: string[] | null;
  stageMin: string | null; stageMax: string | null; checkMinEur: number | null; checkMaxEur: number | null;
  sectors: string[]; thesis: string | null; email: string | null; phone: string | null; createdAt: string;
  contacts: ManualEntityContact[];
  likelyDuplicate: { catalogId: string; reason: 'domain' | 'name' | 'alias'; catalogEntity: { id: string; name: string; website: string | null; verificationStatus: string } } | null;
};

// ManualEntityEditForm and CompareTable predate the queue's UnifiedInvestorRow
// shape (Prompt 572 §B) and are unchanged on purpose: rewriting them to move
// four fields would be churn, and the edit form still PATCHes the same route
// with the same body. Only a `submission` row is never passed here — it has
// no entities row to legacy-shape or PATCH.
function toLegacyManualEntity(r: UnifiedInvestorRow): ManualEntity {
  return {
    id: r.id, orgId: r.orgId, orgName: r.orgName, name: r.name, website: r.website,
    hqCity: r.detail.hqCity, hqCountry: r.detail.hqCountry, geographies: r.detail.geographies,
    stageMin: r.detail.stageMin, stageMax: r.detail.stageMax,
    checkMinEur: r.detail.checkMinEur, checkMaxEur: r.detail.checkMaxEur,
    sectors: r.detail.sectors, thesis: r.detail.thesis,
    email: r.detail.email, phone: r.detail.phone, createdAt: r.createdAt,
    contacts: r.detail.contacts,
    likelyDuplicate: r.catalogMatch
      ? { catalogId: r.catalogMatch.id, reason: 'domain', catalogEntity: r.catalogMatch }
      : null,
  };
}

// Prompt 276 — completeness grade badge for a manually-added row. A best
// (green) to worst (gray) scale, not a pass/fail one: nothing here is
// actually wrong, a low grade just means more enrichment work later.
const GRADE_STYLE: Record<CompletenessGrade, string> = {
  A: 'bg-green-100 text-green-800', B: 'bg-cyan-100 text-cyan-800', C: 'bg-amber-100 text-amber-800',
  D: 'bg-orange-100 text-orange-800', E: 'bg-gray-100 text-gray-600',
};
function GradeBadge({ grade, percent }: { grade: CompletenessGrade; percent: number }) {
  return (
    <Tooltip text={`${percent}% of the fields we care about most are already filled in.`}>
      <span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${GRADE_STYLE[grade]}`}>{grade}</span>
    </Tooltip>
  );
}

function CompareTable({ manual, catalogEntity }: { manual: ManualEntity; catalogEntity: CatalogEntity }) {
  const rows: [string, string, string][] = [
    ['Website', manual.website ?? '—', catalogEntity.website ?? '—'],
    ['HQ', [manual.hqCity, manual.hqCountry].filter(Boolean).join(', ') || '—', [catalogEntity.hq_city, catalogEntity.hq_country].filter(Boolean).join(', ') || '—'],
    ['Geographies', manual.geographies?.join(', ') || '—', catalogEntity.geographies?.join(', ') || '—'],
    ['Stage', fmtStage(manual.stageMin, manual.stageMax), fmtStage(catalogEntity.stage_min, catalogEntity.stage_max)],
    ['Check', fmtCheck(manual.checkMinEur, manual.checkMaxEur), fmtCheck(catalogEntity.check_min_eur, catalogEntity.check_max_eur)],
    // Prompt 570 §D.5 — optional chaining, like the Geographies row above it.
    // These two were the only unguarded `.join` here, and an absent `sectors`
    // on either side threw a TypeError that took the whole Queue page down
    // rather than one cell. Caught on screen: tsc cannot see it (both are
    // typed as arrays) and no test rendered this component. The exposure also
    // rose with this prompt — CompareTable used to sit behind a "Likely
    // duplicate" click and now renders whenever a matched row is expanded.
    ['Sectors', manual.sectors?.join(', ') || '—', catalogEntity.sectors?.join(', ') || '—'],
  ];
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-gray-400">
          <th className="py-1">Field</th><th>From {manual.orgName}</th><th>Catalog: {catalogEntity.name}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, a, b]) => (
          <tr key={label} className="border-t border-gray-100">
            <td className="py-1 text-gray-500">{label}</td><td>{a}</td><td>{b}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Prompt 191 §B — read-only: contacts belong to the startup's own CRM, not
// something the backoffice edits directly (per the prompt's own note, a
// future prompt if that's ever needed).
function ManualEntityContactsPanel({ contacts }: { contacts: ManualEntityContact[] }) {
  if (contacts.length === 0) return <p className="text-xs text-gray-400">No contacts on file for this entity.</p>;
  return (
    <ul className="space-y-1.5 text-xs">
      {contacts.map((c) => (
        <li key={c.id} className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-gray-800">{c.fullName}</span>
          {c.role && <span className="text-gray-400">{c.role}</span>}
          {c.email && <span className="text-gray-500">{c.email}</span>}
          {c.phone && <span className="text-gray-500">{c.phone}</span>}
          {c.linkedinUrl && <a href={c.linkedinUrl} target="_blank" rel="noreferrer" className="text-cyan-700 hover:underline">LinkedIn</a>}
        </li>
      ))}
    </ul>
  );
}

// Prompt 191 §A — the fields most prone to a data-entry error (website,
// HQ, stage, sectors, check size), editable inline before the row is ever
// promoted/merged. Writes only to the source entities row via PATCH
// /manual-entities/[id] — never to catalog_entities directly; the fix only
// reaches the catalog once the admin runs the bulk action below, which
// re-reads entities fresh (same as it already did before this prompt).
function ManualEntityEditForm({ row, onSaved, onCancel }: { row: ManualEntity; onSaved: () => void; onCancel: () => void }) {
  const [website, setWebsite] = useState(row.website ?? '');
  const [hqCity, setHqCity] = useState(row.hqCity ?? '');
  const [hqCountry, setHqCountry] = useState(row.hqCountry ?? '');
  const [stageMin, setStageMin] = useState(row.stageMin ?? '');
  const [stageMax, setStageMax] = useState(row.stageMax ?? '');
  const [sectors, setSectors] = useState(row.sectors.join(', '));
  const [checkMinEur, setCheckMinEur] = useState(row.checkMinEur != null ? String(row.checkMinEur) : '');
  const [checkMaxEur, setCheckMaxEur] = useState(row.checkMaxEur != null ? String(row.checkMaxEur) : '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    setSaving(true); setErr('');
    const res = await fetch(`/api/backoffice/catalog/manual-entities/${row.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        website, hqCity, hqCountry, stageMin: stageMin || null, stageMax: stageMax || null,
        sectors: sectors.split(',').map((s) => s.trim()).filter(Boolean),
        checkMinEur: checkMinEur ? Number(checkMinEur) : null, checkMaxEur: checkMaxEur ? Number(checkMaxEur) : null,
      }),
    });
    const body = await res.json();
    setSaving(false);
    if (body.ok === false) { setErr(body.error); return; }
    onSaved();
  }

  return (
    <div className="space-y-2 rounded-lg border border-gray-100 bg-gray-50/50 p-3 text-xs">
      {err && <p className="text-[#B00000]">{err}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        <label className="flex items-center gap-1">Website
          <input value={website} onChange={(e) => setWebsite(e.target.value)} className="w-40 rounded border border-gray-300 px-1.5 py-0.5" />
        </label>
        <label className="flex items-center gap-1">HQ city
          <input value={hqCity} onChange={(e) => setHqCity(e.target.value)} className="w-28 rounded border border-gray-300 px-1.5 py-0.5" />
        </label>
        <label className="flex items-center gap-1">HQ country
          <input value={hqCountry} onChange={(e) => setHqCountry(e.target.value)} className="w-20 rounded border border-gray-300 px-1.5 py-0.5" />
        </label>
        <label className="flex items-center gap-1">Stage
          <select value={stageMin} onChange={(e) => setStageMin(e.target.value)} className="rounded border border-gray-300 px-1.5 py-0.5">
            <option value="">—</option>
            {STAGE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          –
          <select value={stageMax} onChange={(e) => setStageMax(e.target.value)} className="rounded border border-gray-300 px-1.5 py-0.5">
            <option value="">—</option>
            {STAGE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <label className="flex flex-1 items-center gap-1">Sectors (comma-separated)
          <input value={sectors} onChange={(e) => setSectors(e.target.value)} className="min-w-[160px] flex-1 rounded border border-gray-300 px-1.5 py-0.5" />
        </label>
        <label className="flex items-center gap-1">Check min €
          <input type="number" value={checkMinEur} onChange={(e) => setCheckMinEur(e.target.value)} className="w-24 rounded border border-gray-300 px-1.5 py-0.5" />
        </label>
        <label className="flex items-center gap-1">Check max €
          <input type="number" value={checkMaxEur} onChange={(e) => setCheckMaxEur(e.target.value)} className="w-24 rounded border border-gray-300 px-1.5 py-0.5" />
        </label>
      </div>
      <div className="flex gap-2">
        <button disabled={saving} onClick={save} className="rounded bg-cyan-700 px-2.5 py-1 font-semibold text-white hover:bg-cyan-800 disabled:opacity-40">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button disabled={saving} onClick={onCancel} className="text-gray-400 hover:underline">Cancel</button>
      </div>
    </div>
  );
}

// Prompt 187 §A — every `entities` row with source='manual', across every
// org, cross-checked against the catalog with the same criteria
// MergeDuplicatesTool already uses (see /lib/manual-entity-match.ts).
//
// Prompt 191 — reworked selection model: per-row Merge/Promote buttons
// replaced by a checkbox + single "Add selected to catalog" bulk action
// (§C) — the system still decides merge-vs-promote per row from its own
// likelyDuplicate, exactly as the old per-row buttons did, just triggered
// once for however many rows are checked. Also adds inline editing (§A),
// a read-only contacts expansion (§B), and Dismiss (§E.3) for a row that's
// not worth promoting or merging. A row disappears from this list on its
// own next refresh once treated (§E) — see manual-entities/route.ts's own
// header for the catalog_review_status mechanism (migration 0169,
// proposed, not yet applied).
// Prompt 191 — selection model: per-row Merge/Promote replaced by a checkbox
// plus a single "Add selected to catalog" bulk action; the system still
// decides merge-vs-promote per row. Inline editing (§A), a read-only contacts
// expansion (§B), and Dismiss (§E.3).
//
// Prompt 570 §D.4 — rebuilt on QueueTable (§C). What changed and why:
//
// The list is server-paged, sorted and filtered. It used to load every row and
// do all three in the browser, which was fine at 751 rows and became a lie the
// moment paging existed — "grade A first" would have meant "grade A first
// among these 25". Grade now comes from the route, computed over the whole
// matching set with the same completeness.ts the browser used.
//
// The queue lists what is undecided: pending + probable_match. The 692 rows
// the reconcile linked are gone from here entirely, and the resolved ones sit
// behind "Show resolved" rather than mixed in.
//
// Five columns left the table for the expand panel — HQ, geographies, stage,
// sectors, contact detail — because five stacked values per cell made every
// row five lines tall.
//
// The merge-vs-promote contract is now exact and comes from the data:
// probable_match always carries a catalog row to merge into, pending never
// does (see catalog-candidate-reconcile.ts). This component asserts that
// rather than assuming it — a pending row with a match, or the reverse, is a
// bug upstream and is reported instead of acted on.
// Prompt 572 §B — merges what used to be two tabs (AddedByStartupsTab /
// "Catalog candidates" below, and the standalone SubmissionsTab further up)
// into ONE queue, per §B.1's own instruction: "Fundir entities manuais... e
// investor_submissions... numa fila só." The API route
// (manual-entities/route.ts) does the actual merging server-side; this
// component is unchanged in spirit from the old AddedByStartupsTab (same
// QueueTable-based list, same bulk actions for candidate rows) with a
// ReviewQueueLayout panel replacing the old inline renderExpanded, and a
// second action set for submission rows.
//
// The old inline edit-form (ManualEntityEditForm) and side-by-side CompareTable
// still work for candidate rows — toLegacyManualEntity widens to accept
// UnifiedInvestorRow instead of the retired CandidateRow, everything else
// about them is untouched. Submission rows never had either (no entities row
// to PATCH or compare), so they keep the plain HQ/sectors/stage/check `<dl>`.
type UnifiedInvestorRow = {
  id: string; kind: 'candidate' | 'submission';
  orgId: string; orgName: string; orgIsInternal: boolean;
  addedByEmail: string | null;
  name: string; website: string | null; grade: CompletenessGrade; createdAt: string;
  status: string;
  hasContact: boolean;
  catalogMatch: { id: string; name: string; website: string | null; verificationStatus: string } | null;
  demand: number;
  detail: {
    hqCity: string | null; hqCountry: string | null; geographies: string[] | null;
    stageMin: string | null; stageMax: string | null; checkMinEur: number | null; checkMaxEur: number | null;
    sectors: string[]; thesis: string | null; email: string | null; phone: string | null;
    contacts: ManualEntityContact[];
    submissionPayload?: { name: string; type: string; hq_city?: string; hq_country?: string; sectors: string[]; website?: string; notes?: string };
  };
};

function NewInvestorsTab() {
  const params = useSearchParams();
  const [rows, setRows] = useState<UnifiedInvestorRow[] | null>(null);
  const [catalog, setCatalog] = useState<CatalogEntity[] | null>(null);
  const [total, setTotal] = useState(0);
  const [hiddenInternal, setHiddenInternal] = useState(0);
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState('');

  const qs = params.toString();
  const refresh = useCallback(() => {
    fetch(`/api/backoffice/catalog/manual-entities?${qs}`).then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setRows(body.manualEntities);
      setTotal(body.total ?? 0);
      setHiddenInternal(body.hiddenInternal ?? 0);
    }).catch((e) => setErr((e as Error).message));
  }, [qs]);
  useEffect(refresh, [refresh]);

  // Prompt 190's own catalog copy, unchanged: this queue's panel needs the
  // matched catalog row's own fields (website, verification) beside the
  // candidate's, and QualityPanel (rendered below, unchanged) never needed
  // this fetch in the first place.
  useEffect(() => {
    fetch('/api/backoffice/catalog').then((r) => r.json()).then((body) => { if (body.ok !== false) setCatalog(body.catalog); }).catch(() => {});
  }, []);

  async function dismiss(row: UnifiedInvestorRow, reason: string) {
    setBusyId(row.id);
    const res = await fetch(`/api/backoffice/catalog/manual-entities/${row.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dismiss: true, reason }),
    });
    const body = await res.json();
    setBusyId(null);
    if (body.ok === false) { setActionErr((prev) => ({ ...prev, [row.id]: body.error })); return; }
    setSelectedId(null);
    refresh();
  }

  async function reviewSubmission(row: UnifiedInvestorRow, decision: 'approved' | 'rejected', reason?: string) {
    setBusyId(row.id);
    const res = await fetch(`/api/backoffice/submissions/${row.id}/review`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, notes: reason }),
    });
    const body = await res.json();
    setBusyId(null);
    if (body.ok === false) { setActionErr((prev) => ({ ...prev, [row.id]: body.error })); return; }
    setSelectedId(null);
    refresh();
  }

  async function addToCatalog(row: UnifiedInvestorRow) {
    if (row.status === 'probable_match' && !row.catalogMatch) {
      setActionErr((prev) => ({ ...prev, [row.id]: 'No catalog match stored for a probable_match row — re-run reconcile.' }));
      return;
    }
    setBusyId(row.id);
    const [url, payload] = row.catalogMatch
      ? ['/api/backoffice/catalog/merge', { keepId: row.catalogMatch.id, manualEntityId: row.id }]
      : ['/api/backoffice/catalog/promote', { manualEntityId: row.id }];
    const res = await fetch(url as string, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await res.json();
    setBusyId(null);
    if (body.ok === false) { setActionErr((prev) => ({ ...prev, [row.id]: body.error })); return; }
    setSelectedId(null);
    refresh();
  }

  // Prompt 570 §D.6 — re-run the reconcile over just these rows. The same
  // route the whole-catalog run uses, scoped by ids: exact domain matches
  // become `linked` and leave the queue without anyone deciding anything,
  // which is the point — that decision was never a judgement call.
  // Prompt 572 §B — submission rows have no reconcile/dismiss/merge
  // endpoint of their own (they go through reviewSubmission instead), so
  // every bulk action here filters to kind==='candidate' first rather than
  // erroring on the rest of a mixed selection.
  async function relinkSelected(ids: string[], clear: () => void) {
    const candidateIds = ids.filter((id) => rows?.find((r) => r.id === id)?.kind === 'candidate');
    if (candidateIds.length === 0) { clear(); return; }
    setBulkBusy(true); setBulkResult('');
    const res = await fetch('/api/backoffice/catalog/candidates/reconcile', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: candidateIds }),
    });
    const body = await res.json();
    setBulkBusy(false);
    setBulkResult(body.ok === false
      ? body.error
      : `${body.after?.linked ?? 0} linked, ${body.after?.probable_match ?? 0} probable, ${body.after?.pending ?? 0} still pending.`);
    clear(); refresh();
  }

  // One reason for the batch, asked once. The API requires it per row anyway,
  // so a cancelled prompt cannot half-dismiss anything.
  async function dismissSelected(ids: string[], clear: () => void) {
    const candidateIds = ids.filter((id) => rows?.find((r) => r.id === id)?.kind === 'candidate');
    if (candidateIds.length === 0) { clear(); return; }
    const reason = window.prompt(`Why are these ${candidateIds.length} candidates not going into the catalog?`)?.trim();
    if (!reason) return;
    setBulkBusy(true); setBulkResult('');
    const outcomes = await Promise.all(candidateIds.map(async (id) => {
      const res = await fetch(`/api/backoffice/catalog/manual-entities/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dismiss: true, reason }),
      });
      const body = await res.json();
      return { id, ok: body.ok !== false, error: body.ok === false ? body.error : undefined };
    }));
    setBulkBusy(false);
    const failed = outcomes.filter((o) => !o.ok);
    setBulkResult(failed.length === 0
      ? `Dismissed ${outcomes.length}.`
      : `Dismissed ${outcomes.length - failed.length} of ${outcomes.length}; ${failed.length} failed.`);
    setActionErr((prev) => {
      const next = { ...prev };
      for (const o of failed) if (o.error) next[o.id] = o.error;
      return next;
    });
    clear(); refresh();
  }

  // One action; the row's stored status decides merge vs promote, exactly what
  // the two old per-row buttons did — only now the decision is a fact in the
  // database rather than something recomputed on every render.
  async function addSelectedToCatalog(ids: string[], clear: () => void) {
    const candidateRows = ids.map((id) => rows?.find((r) => r.id === id)).filter((r): r is UnifiedInvestorRow => !!r && r.kind === 'candidate');
    if (candidateRows.length === 0) { clear(); return; }
    setBulkBusy(true); setBulkResult('');
    const outcomes = await Promise.all(candidateRows.map(async (row) => {
      // The invariant, checked rather than trusted. If it ever breaks, merging
      // on a match the rules declined to make would quietly write the wrong
      // firm into the catalog; refusing is the cheaper failure.
      if (row.status === 'probable_match' && !row.catalogMatch) {
        return { id: row.id, ok: false, error: 'No catalog match stored for a probable_match row — re-run reconcile.' };
      }
      if (row.status === 'pending' && row.catalogMatch) {
        return { id: row.id, ok: false, error: 'A pending row carries a match — re-run reconcile before adding it.' };
      }

      const [url, payload] = row.catalogMatch
        ? ['/api/backoffice/catalog/merge', { keepId: row.catalogMatch.id, manualEntityId: row.id }]
        : ['/api/backoffice/catalog/promote', { manualEntityId: row.id }];
      const res = await fetch(url as string, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const body = await res.json();
      return { id: row.id, ok: body.ok !== false, error: body.ok === false ? body.error : undefined };
    }));
    setBulkBusy(false);
    const failed = outcomes.filter((o) => !o.ok);
    setBulkResult(failed.length === 0
      ? `Added ${outcomes.length} entit${outcomes.length === 1 ? 'y' : 'ies'} to the catalog.`
      : `Added ${outcomes.length - failed.length} of ${outcomes.length}; ${failed.length} failed — see the row(s) below.`);
    setActionErr((prev) => {
      const next = { ...prev };
      for (const o of failed) if (o.error) next[o.id] = o.error;
      return next;
    });
    clear();
    refresh();
  }

  if (err) return <Card title="New investors"><p className="text-sm text-[#B00000]">{err}</p></Card>;

  const columns: QueueColumn<UnifiedInvestorRow>[] = [
    { key: 'grade', label: 'Grade', sortable: true, render: (r) => <GradeBadge grade={r.grade} percent={0} /> },
    {
      key: 'investor', label: 'Investor', sortable: true,
      render: (r) => (
        <div>
          <div className="font-medium">{r.name}</div>
          {r.website && <div className="text-xs font-normal text-gray-400">{r.website}</div>}
        </div>
      ),
    },
    { key: 'org', label: 'Added by', render: (r) => <span className="text-gray-500">{r.orgName}{r.addedByEmail ? ` · ${r.addedByEmail}` : ''}</span> },
    {
      key: 'added', label: 'Added when', sortable: true,
      render: (r) => <span className="text-gray-500">{new Date(r.createdAt).toLocaleDateString()}</span>,
    },
    {
      key: 'match', label: 'Match', sortable: true,
      render: (r) => (r.catalogMatch
        ? <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
            probable → {r.catalogMatch.name}
          </span>
        : <span className="text-xs text-gray-300">—</span>),
    },
    {
      key: 'contact', label: 'Contact', align: 'right',
      render: (r) => (r.hasContact
        ? <span className="text-green-600" title="Has a person, an inbox or a phone">✓</span>
        : <span className="text-gray-300">—</span>),
    },
    {
      // Prompt 572 §B.2 — cross-org dedup count via catalog-dedupe.ts,
      // computed server-side over the whole merged set (see
      // manual-entities/route.ts). Reply signal / wave are a scope-cut,
      // flagged in that route's own header comment.
      key: 'demand', label: 'Demand', sortable: true,
      render: (r) => (
        <span className="text-gray-600" title={`${r.demand} org${r.demand === 1 ? '' : 's'} added a firm matching this name or domain`}>
          {r.demand} org{r.demand === 1 ? '' : 's'}
        </span>
      ),
    },
    {
      key: 'source', label: 'Source',
      render: (r) => <span className="text-xs text-gray-400">{r.kind === 'submission' ? 'submission form' : 'manual pipeline entry'}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <Card title={`New investors (${total})`}>
        <p className="mb-3 text-xs text-gray-500">
          Investors a founder added by hand, or submitted through the public form — one queue (Prompt 572 §B),
          still undecided. Rows whose domain matches the catalog exactly are linked automatically and never appear
          here. A row with a probable match merges into it (filling gaps only, never overwriting); a row without
          one is promoted as a new entry. Demand counts every org whose own entry normalizes to the same name or
          domain (via catalog-dedupe.ts).
        </p>
        <ReviewQueueLayout<UnifiedInvestorRow>
          columns={columns}
          rows={rows ?? []}
          total={total}
          loading={rows === null}
          getRowId={(r) => r.id}
          hiddenInternalCount={hiddenInternal}
          emptyMessage="Nothing left to review here."
          selectedId={selectedId}
          onSelect={setSelectedId}
          panelTitle={(r) => r.name}
          filterControls={(state, set) => (
            <label className="flex items-center gap-1.5">
              Minimum grade
              <select value={state.filters.grade ?? 'all'}
                onChange={(e) => set({ filters: { ...state.filters, grade: e.target.value === 'all' ? '' : e.target.value } })}
                className="rounded border border-gray-300 px-1.5 py-0.5">
                <option value="all">All</option>
                {(['A', 'B', 'C', 'D', 'E'] as const).map((g) => <option key={g} value={g}>{g} or better</option>)}
              </select>
            </label>
          )}
          renderBulkActions={(ids, clear) => (
            <>
              {/* Prompt 570 §D.6 — three actions, because "add to catalog"
                  collapsed two different decisions into one button and gave no
                  way to say "these are the same firm" without also promoting
                  the ones that are not. Scoped to kind==='candidate' rows. */}
              <button disabled={bulkBusy} onClick={() => void addSelectedToCatalog(ids, clear)}
                className="rounded-lg bg-[#0E7490] px-3 py-1 text-xs font-medium text-white disabled:opacity-40">
                {bulkBusy ? 'Working…' : `Add ${ids.length} to catalog`}
              </button>
              <button disabled={bulkBusy} onClick={() => void relinkSelected(ids, clear)}
                title="Re-run the matcher over these rows; exact domain matches link and leave the queue"
                className="rounded-lg border border-[#0E7490] px-3 py-1 text-xs font-medium text-[#0E7490] disabled:opacity-40">
                Link exact matches
              </button>
              <button disabled={bulkBusy} onClick={() => void dismissSelected(ids, clear)}
                className="rounded-lg border border-gray-300 px-3 py-1 text-xs text-gray-600 disabled:opacity-40">
                Dismiss…
              </button>
              {bulkResult && <span className="text-gray-500">{bulkResult}</span>}
            </>
          )}
          renderPanel={(row) => {
            const catalogEntry = row.catalogMatch ? catalog?.find((c) => c.id === row.catalogMatch!.id) : undefined;
            return (
              <div className="space-y-4">
                {actionErr[row.id] && <p className="text-xs text-[#B00000]">{actionErr[row.id]}</p>}
                <ReviewFacts
                  what={<>{row.name}{row.website && <> — <a href={row.website.startsWith('http') ? row.website : `https://${row.website}`} target="_blank" rel="noreferrer" className="text-[#0E7490] hover:underline">{row.website}</a></>}</>}
                  whoFrom={<>{row.orgName}{row.addedByEmail ? ` · ${row.addedByEmail}` : ''} · {row.kind === 'submission' ? 'submission form' : 'manual pipeline entry'} · {new Date(row.createdAt).toLocaleDateString()}</>}
                  proof={row.catalogMatch
                    ? <>Probable match: <b>{row.catalogMatch.name}</b>{catalogEntry?.website ? ` (${catalogEntry.website})` : ''} — {row.catalogMatch.verificationStatus}</>
                    : 'No catalog match found — this would be a new entry.'}
                  thenWhat={row.kind === 'submission'
                    ? (row.catalogMatch ? `Merges into ${row.catalogMatch.name}, filling empty fields only.` : 'Adds a new, verified catalog entry.')
                    : (row.catalogMatch ? `Merges into ${row.catalogMatch.name}, filling empty fields only, overwriting nothing.` : 'Promotes as a new catalog entry.')}
                />
                {row.kind === 'candidate' && editingId === row.id ? (
                  // Prompt 191 §A's inline fixer, unchanged — still PATCHes
                  // manual-entities/[id] with the same body. Only its trigger
                  // moved (a panel link instead of a row-level "Edit" button).
                  <ManualEntityEditForm row={toLegacyManualEntity(row)} onCancel={() => setEditingId(null)}
                    onSaved={() => { setEditingId(null); refresh(); }} />
                ) : (
                  <>
                    {row.kind === 'candidate' && catalogEntry ? (
                      // §D.5 — candidate against its probable catalog match, side
                      // by side, reusing the merge tool's own comparison table.
                      <CompareTable manual={toLegacyManualEntity(row)} catalogEntity={catalogEntry} />
                    ) : (
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600">
                        <div><dt className="text-gray-400">HQ</dt><dd>{[row.detail.hqCity, row.detail.hqCountry].filter(Boolean).join(', ') || '—'}</dd></div>
                        <div><dt className="text-gray-400">Sectors</dt><dd>{row.detail.sectors.length ? row.detail.sectors.join(', ') : '—'}</dd></div>
                        <div><dt className="text-gray-400">Stage</dt><dd>{fmtStage(row.detail.stageMin, row.detail.stageMax)}</dd></div>
                        <div><dt className="text-gray-400">Check size</dt><dd>{fmtCheck(row.detail.checkMinEur, row.detail.checkMaxEur)}</dd></div>
                      </dl>
                    )}
                    {row.detail.thesis && <p className="text-xs text-gray-600">{row.detail.thesis}</p>}
                    <div>
                      <div className="flex items-center justify-between">
                        <p className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">Contacts</p>
                        {row.kind === 'candidate' && (
                          <button onClick={() => setEditingId(row.id)} className="text-[10.5px] font-medium text-cyan-700 hover:underline">
                            Fix a field
                          </button>
                        )}
                      </div>
                      <div className="mt-1">
                        <ManualEntityContactsPanel contacts={row.detail.contacts} />
                      </div>
                    </div>
                  </>
                )}
                {row.kind === 'candidate' ? (
                  <ReviewActionFooter
                    busy={busyId === row.id}
                    onApprove={() => addToCatalog(row)}
                    approveLabel={row.catalogMatch ? 'Merge into match' : 'Promote as new'}
                    onDismiss={(reason) => dismiss(row, reason)}
                    dismissLabel="Dismiss"
                  />
                ) : (
                  <ReviewActionFooter
                    busy={busyId === row.id}
                    onApprove={() => reviewSubmission(row, 'approved')}
                    approveLabel="Verify & merge to catalog"
                    onReject={(reason) => reviewSubmission(row, 'rejected', reason)}
                    rejectLabel="Reject"
                  />
                )}
              </div>
            );
          }}
        />
      </Card>
      <QualityPanel />
    </div>
  );
}

// Prompt 264 — bulk version of the entity-dossier "Add as contact" button
// (Prompt 263), same parser/needs-review check (key-people-parse.ts),
// backed by /api/backoffice/key-people-promote (service-role, re-verifies
// every entity server-side before writing — never trusts this preview).
// Idempotent by construction: an applied (or otherwise no-longer-eligible)
// entity simply isn't in the next GET's result, same as the single-button
// version derives "Added as contact" from db.people instead of its own flag.
interface KeyPeopleCandidate {
  entityId: string; entityName: string; orgId: string; orgName: string;
  parsed: { fullName: string; role: string | null }[]; needsReview: boolean;
}

function KeyPeoplePromoteTab() {
  const [items, setItems] = useState<KeyPeopleCandidate[] | null>(null);
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState('');
  // Prompt 596 §A/§C — how many entities are being held back because they
  // already have contacts, so the list's size is explained rather than
  // mysterious.
  const [excludedWithContacts, setExcludedWithContacts] = useState<number | null>(null);

  function refresh() {
    fetch('/api/backoffice/key-people-promote').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      const list = body.items as KeyPeopleCandidate[];
      setItems(list);
      setExcludedWithContacts(typeof body.excludedWithContacts === 'number' ? body.excludedWithContacts : null);
      // Every non-needs-review row starts checked, per the prompt's own
      // "todas selecionadas por defeito, exceto as marcadas needs review."
      setSelected(new Set(list.filter((i) => !i.needsReview).map((i) => i.entityId)));
    });
  }
  useEffect(refresh, []);

  function toggle(entityId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(entityId)) next.delete(entityId); else next.add(entityId);
      return next;
    });
  }

  async function applySelected() {
    if (selected.size === 0) return;
    setApplying(true); setResult('');
    try {
      const res = await fetch('/api/backoffice/key-people-promote', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entityIds: [...selected] }),
      });
      const body = await res.json();
      if (body.ok === false) { setResult(body.error); return; }
      const applied = body.applied.length;
      const skipped = body.skipped.length;
      setResult(skipped === 0
        ? `Added contacts for ${applied} entit${applied === 1 ? 'y' : 'ies'}.`
        : `Added contacts for ${applied}; ${skipped} skipped (already handled, or failed server-side re-check).`);
      refresh();
    } finally {
      setApplying(false);
    }
  }

  if (err) return <Card title="Key people"><p className="text-sm text-[#B00000]">{err}</p></Card>;
  if (!items) return <Card title="Key people"><p className="text-sm text-gray-400">Loading…</p></Card>;

  const clean = items.filter((i) => !i.needsReview);
  const needsReview = items.filter((i) => i.needsReview);

  return (
    <Card title={`Key people — verified research not yet real contacts (${items.length})`}>
      <p className="mb-3 text-xs text-gray-500">
        Every entity below has a human-verified <code>key_people</code> contribution but zero contacts on file —
        the founder can see the names but pre-flight, contact order, and messaging all read from real{' '}
        <code>people</code> rows, which none of these have yet. Applying creates one contact per parsed name, ranked
        1, 2, 3… by the order they appear in the text — never inferred from title.
      </p>
      {/* Prompt 596 §A/§C — this list used to be silently wrong: the
          "already has contacts" exclusion was read without paging, so
          PostgREST's 1000-row cap hid ~780 of the 1782 people rows and
          their entities looked empty (105 offered; direct SQL says 1 of 246
          genuinely has none). Applying would have created second copies for
          ~104 entities that already had contacts. The read is paged now,
          and the number held back is stated rather than left to be
          inferred from a list that quietly shrank. */}
      {excludedWithContacts !== null && excludedWithContacts > 0 && (
        <p className="mb-3 rounded-lg bg-gray-50 p-2 text-xs text-gray-600">
          {excludedWithContacts} entit{excludedWithContacts === 1 ? 'y is' : 'ies are'} not listed because {excludedWithContacts === 1 ? 'it' : 'they'} already
          {' '}ha{excludedWithContacts === 1 ? 's' : 've'} contacts on file — this queue only ever offers entities with none, so applying
          {' '}can never create a second copy of someone who is already there.
        </p>
      )}
      <div className="mb-3 flex items-center gap-2">
        <button disabled={applying || selected.size === 0} onClick={applySelected}
          className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
          {applying ? 'Applying…' : `Apply selected (${selected.size})`}
        </button>
        {result && <span className="text-xs text-gray-500">{result}</span>}
      </div>
      {items.length === 0 ? <p className="text-sm text-gray-400">Queue clear.</p> : (
        <div className="space-y-4">
          {clean.length > 0 && (
            <ul className="space-y-2">
              {clean.map((c) => (
                <li key={c.entityId} className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <input type="checkbox" checked={selected.has(c.entityId)} onChange={() => toggle(c.entityId)} />
                    <span className="font-semibold">{c.entityName}</span>
                    <span className="text-xs text-gray-400">{c.orgName}</span>
                  </div>
                  <p className="mt-1.5 text-xs text-gray-600">
                    {c.parsed.map((p, i) => `${i + 1}. ${p.fullName} — ${p.role}`).join('  ·  ')}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {needsReview.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-2">
              <p className="mb-1.5 text-xs font-semibold text-amber-800">Needs review — won&apos;t be written ({needsReview.length})</p>
              <ul className="space-y-1.5 text-xs">
                {needsReview.map((c) => (
                  <li key={c.entityId} className="rounded-lg border border-amber-100 bg-white p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{c.entityName}</span>
                      <span className="text-gray-400">{c.orgName}</span>
                    </div>
                    <p className="mt-1 text-gray-500">
                      Raw text — doesn&apos;t parse cleanly into name + role: {c.parsed.map((p) => p.fullName).join(' / ') || '(nothing parsed)'}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// Prompt 570 §B / 575 — the Suspense boundary useSearchParams() requires.
//
// Without it `next build` compiles and then fails at the prerender step with
// "useSearchParams() should be wrapped in a suspense boundary", and the deploy
// never lands. Worth stating how it got past me: I was grepping the build
// output for /Compiled|Failed/, which matches "✓ Compiled successfully" and
// does NOT match "Error occurred prerendering page". The build was red and I
// read it as green three times. Check the exit code, not a pattern.
export default function BackofficeQueuePage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-400">Loading queue…</div>}>
      <BackofficeQueueContent />
    </Suspense>
  );
}

function BackofficeQueueContent() {
  // Prompt 570 §B — the board is the landing view, and ?tab= finally works.
  //
  // It never did: this was useState('contributions') and the query string was
  // ignored, so every "direct link" to a queue silently opened the first tab.
  // The prompt assumed those links worked; they did not, and the board would
  // have inherited the same dead end.
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const urlTab = params.get('tab');
  const tab: Tab | null = TABS.some((t) => t.key === urlTab) ? (urlTab as Tab) : null;

  const openTab = useCallback((key: string) => {
    const next = new URLSearchParams(params.toString());
    next.set('tab', key);
    // Only the tab survives the move: a page or sort from the queue you just
    // left means nothing in the one you are opening.
    for (const k of ['page', 'size', 'sort', 'dir', 'grade']) next.delete(k);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [params, pathname, router]);

  const backToBoard = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [pathname, router]);

  // Prompt 572 §B.1 — "Submissions" and "Catalog candidates" left TABS (so
  // they no longer render as nav items) but an old bookmark/link naming
  // either key by itself still has to land somewhere real, not the "All
  // queues" board it would silently fall back to otherwise (TABS.some()
  // above returns false for a key that's valid in Tab but absent from TABS).
  useEffect(() => {
    if (urlTab === 'candidates' || urlTab === 'submissions') openTab('new_investors');
    if (urlTab === 'domain_mismatch') openTab('identity');
    // Prompt 574 §B — keeps which of the two an old link meant, as its own
    // ?source= rather than collapsing both into the same undifferentiated
    // "trust_safety" landing.
    if (urlTab === 'suspicious' || urlTab === 'fraud') {
      const next = new URLSearchParams(params.toString());
      next.set('tab', 'trust_safety'); next.set('source', urlTab);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    }
  }, [urlTab, openTab, params, pathname, router]);

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold">Queue</h1>
      {/* Prompt 256 §A — this Fila is the cross-org admin queue (contributions,
          candidates, submissions, …); interaction date/data-quality review is
          a different, org-scoped queue that stays in Settings (see
          NeedsReviewPanel.tsx's own header for why it can't just move here).
          This is a signpost so it isn't lost between the two, not a new
          feature — no live count to avoid a second cross-org fetch for a
          single link. */}
      <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
        Looking for interactions with an unconfirmed date? That queue is per-startup, in{' '}
        <Link href="/settings?tab=needs-review" className="font-medium text-[#0E7490] hover:underline">
          Settings → Import history → Needs review
        </Link>.
      </p>
      {/* Prompt 598 §A.1 — the tab bar is gone. Review had two navigations
          for the same six queues plus three that existed only here (and so
          carried no badge anywhere); the sidebar is now the single place a
          queue is chosen, and this page's "All queues" board is the landing
          that still lists every queue, including the empty ones. A queue
          view keeps one way back to that board, since the row of tabs that
          used to serve as it no longer exists. */}
      {tab !== null && (
        <button onClick={backToBoard} className="text-xs text-[#0E7490] hover:underline">← All queues</button>
      )}
      {tab === null && (
        <QueueTriageBoard
          labels={REVIEW_CARD_LABELS}
          transform={groupIntoReviewCards}
          onOpen={openTab}
        />
      )}
      {tab === 'new_investors' && <NewInvestorsTab />}
      {tab === 'contributions' && <ContributionsTab />}
      {tab === 'claims' && <ClaimsTab />}
      {tab === 'identity' && <InvestorIdentityTab />}
      {tab === 'gdpr' && <GdprTab />}
      {tab === 'trust_safety' && <TrustSafetyTab />}
      {tab === 'key_people' && <KeyPeoplePromoteTab />}
      {tab === 'community' && <ContributionsByUsersTab />}
      {tab === 'competitor_intel' && <CompetitorIntelTab />}
    </div>
  );
}
