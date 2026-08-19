'use client';
// BLOCO 3 — Fila: the 4 review queues, tabbed, each pending→decided.
// Contributions/GDPR logic carried over from the pre-Bloco-3 backoffice
// page; Submissions/Claims are new tabs consolidating what used to be a
// separate founder-store-scoped "Review queue" section.
import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, Tooltip } from '@/components/ui';
import { classifyConflict, type ConflictClass } from '@/lib/contribution-diff';
import { SuspiciousAccountsTab } from '@/components/backoffice/SuspiciousAccountsTab';
import { ENTITY_ENRICHMENT_FIELD_LABELS, isKnownEntityField } from '@/lib/entity-enrichment';
import { manualEntityCompleteness, type CompletenessGrade } from '@/lib/completeness';

// Prompt 190 — 'candidates' ("Catalog candidates") added next to
// Contributions per Nuno's explicit decision: "Added by startups" (Prompt
// 187 §A) is review work, same pattern as Contributions, and doesn't
// belong hidden inside the Catalog page. Moved here verbatim from
// backoffice/catalog/page.tsx (the CatalogCandidatesTab/AddedByStartupsTab/
// QualityPanel section below) — no logic changes, per the prompt's own
// scope.
type Tab = 'contributions' | 'candidates' | 'submissions' | 'claims' | 'identity' | 'gdpr' | 'suspicious' | 'key_people' | 'community';

const TABS: { key: Tab; label: string }[] = [
  { key: 'contributions', label: 'Contributions' },
  { key: 'candidates', label: 'Catalog candidates' },
  { key: 'submissions', label: 'Submissions' },
  { key: 'claims', label: 'Claims' },
  { key: 'identity', label: 'Investor identity' },
  { key: 'gdpr', label: 'GDPR' },
  // Prompt 244/245 — manual flagging by developers (not automatic
  // detection), see SuspiciousAccountsTab.tsx.
  { key: 'suspicious', label: 'Suspicious accounts' },
  // Prompt 264 — bulk-promote verified key_people research to real
  // contacts, across every org (248 entities had this gap in production
  // at the time this shipped; a reusable screen, not a one-off fix).
  { key: 'key_people', label: 'Key people' },
  // Prompt 266 §6 — separate from "Contributions" above: that tab is one
  // org's authored edit vs the record on file; this one is two DIFFERENT
  // orgs independently agreeing on the same still-blank field — its own
  // review surface (catalog_field_consensus, not contributions).
  { key: 'community', label: 'Contributions — by users' },
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
  const [items, setItems] = useState<Contribution[] | null>(null);
  const [err, setErr] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [classFilter, setClassFilter] = useState<ConflictClass | 'all'>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

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

  const classified = useMemo(() => (items ?? []).map((c) => ({
    ...c, cls: classifyConflict(c.existing_value, c.value) as ConflictClass,
  })), [items]);

  if (err) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!items) return <p className="text-sm text-gray-400">Loading…</p>;

  const pendingAll = classified.filter((c) => c.status === 'submitted');
  const cosmeticCount = pendingAll.filter((c) => c.cls === 'cosmetic').length;
  const substantiveCount = pendingAll.filter((c) => c.cls === 'substantive').length;
  const pending = classFilter === 'all' ? pendingAll : pendingAll.filter((c) => c.cls === classFilter);
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

  function bulkApproveHighConfidence() {
    if (!window.confirm(`Approve ${highConfidenceAi.length} AI-sourced contribution${highConfidenceAi.length === 1 ? '' : 's'} at ≥80% confidence?`)) return;
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
    <Card title={`Contributions — cross-org (${pendingAll.length})`}>
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
        </div>
        {pending.length > 0 && (
          <label className="ml-2 flex items-center gap-1.5 text-xs text-gray-500">
            <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} />
            Select all in view ({pending.length})
          </label>
        )}
        {highConfidenceAi.length > 0 && (
          <button disabled={bulkBusy} onClick={bulkApproveHighConfidence}
            className="rounded-lg border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-medium text-green-800 hover:bg-green-100 disabled:opacity-40">
            {bulkBusy ? 'Working…' : `Approve all ≥80% AI confidence (${highConfidenceAi.length})`}
          </button>
        )}
        {selected.size > 0 && (
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

      {groups.size === 0 ? <p className="text-sm text-gray-400">Queue clear.</p> : (
        <div className="space-y-3">
          {[...groups.entries()].map(([key, list]) => (
            <div key={key} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
              <div className="mb-1.5 text-sm font-semibold">{list[0].subject_name} <span className="font-normal text-gray-400">({list[0].subject_type})</span></div>
              <ul className="space-y-1.5">
                {list.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleOne(c.id)} />
                    <Tooltip text={c.cls === 'cosmetic' ? 'Same value after normalizing case/accents/quotes/whitespace.' : 'A genuinely different value from what is on record.'}>
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${CLASS_STYLE[c.cls]}`}>{c.cls}</span>
                    </Tooltip>
                    <span className="font-medium">{c.field}:</span> {String(c.value)}
                    {c.source === 'ai' ? (
                      <span className="rounded-full bg-cyan-100 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-800">
                        ✨ AI {c.confidence != null ? `${Math.round(c.confidence * 100)}%` : ''}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">by {c.org_name} · {c.created_at.slice(0, 10)}</span>
                    )}
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
          ))}
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

  function confirmBulk() {
    if (!window.confirm(`Approve ${concordant.length} field${concordant.length === 1 ? '' : 's'} with 2+ independently reporting orgs?`)) return;
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

type Submission = {
  id: string; org_id: string; org_name: string; status: 'pending_review' | 'approved' | 'rejected' | 'merged';
  payload: { name: string; type: string; hq_city?: string; hq_country?: string; sectors: string[]; website?: string; notes?: string };
  reviewer_notes: string | null; created_at: string; reviewed_at: string | null;
};

function SubmissionsTab() {
  const [items, setItems] = useState<Submission[] | null>(null);
  const [err, setErr] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});

  function refresh() {
    fetch('/api/backoffice/submissions').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setItems(body.submissions);
    });
  }
  useEffect(refresh, []);

  async function review(id: string, decision: 'approved' | 'rejected') {
    await fetch(`/api/backoffice/submissions/${id}/review`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, notes: notes[id] }),
    });
    refresh();
  }

  if (err) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!items) return <p className="text-sm text-gray-400">Loading…</p>;
  const pending = items.filter((s) => s.status === 'pending_review');
  const decided = items.filter((s) => s.status !== 'pending_review');

  return (
    <Card title={`Submissions — cross-org (${pending.length})`}>
      <p className="mb-3 text-xs text-gray-500">Founder-submitted investors. Approve merges into the global catalog (verified); only verified entries distribute via packs.</p>
      {pending.length === 0 ? <p className="text-sm text-gray-400">Queue clear.</p> : (
        <ul className="space-y-3">
          {pending.map((s) => (
            <li key={s.id} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">{s.payload.name}</span>
                <span className="rounded-full bg-white border border-gray-200 px-2 py-0.5 text-[11px] text-gray-500">{s.payload.type.replace('_', ' ')}</span>
                <span className="text-xs text-gray-400">{s.payload.hq_city}{s.payload.hq_country ? `, ${s.payload.hq_country}` : ''}</span>
                {s.payload.website && <a href={s.payload.website} target="_blank" rel="noreferrer" className="text-xs text-[#0E7490] hover:underline">{s.payload.website.replace('https://', '')}</a>}
                <span className="ml-auto text-[11px] text-gray-400">by <b>{s.org_name}</b> · {s.created_at.slice(0, 10)}</span>
              </div>
              {s.payload.sectors?.length > 0 && (
                <div className="mt-1.5 flex gap-1">
                  {s.payload.sectors.map((x) => <span key={x} className="rounded-full bg-white border border-gray-200 px-2 py-0.5 text-[10px] text-gray-500">{x}</span>)}
                </div>
              )}
              {s.payload.notes && <p className="mt-2 text-xs text-gray-500">Submitter notes: {s.payload.notes}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <input placeholder="Reviewer notes" value={notes[s.id] ?? ''} onChange={(e) => setNotes({ ...notes, [s.id]: e.target.value })}
                  className="min-w-[240px] flex-1 rounded-xl border border-gray-200 px-3 py-1.5 text-sm" />
                <Tooltip text="Confirms this investor is real and adds it to the shared catalog every org can discover.">
                  <button onClick={() => review(s.id, 'approved')} className="rounded-xl bg-green-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-green-800">Verify & merge to catalog</button>
                </Tooltip>
                <Tooltip text="Declines this submission — it stays private to the submitting org only.">
                  <button onClick={() => review(s.id, 'rejected')} className="rounded-xl border border-red-200 px-3 py-1.5 text-sm text-[#B00000] hover:bg-red-50">Reject</button>
                </Tooltip>
              </div>
            </li>
          ))}
        </ul>
      )}
      {decided.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-gray-400">Decided ({decided.length})</summary>
          <ul className="mt-2 space-y-1.5 text-sm">
            {decided.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${s.status === 'approved' || s.status === 'merged' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{s.status}</span>
                <span className="font-medium">{s.payload.name}</span>
                <span className="text-xs text-gray-400">by {s.org_name} · {s.reviewed_at?.slice(0, 10)}</span>
                {s.reviewer_notes && <span className="text-xs text-gray-500">— {s.reviewer_notes}</span>}
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
  matches: { personId: string; name: string; orgName: string }[];
};

const GDPR_DEADLINE_DAYS = 30;

function daysLeft(createdAt: string): number {
  const deadline = new Date(createdAt).getTime() + GDPR_DEADLINE_DAYS * 24 * 60 * 60 * 1000;
  return Math.ceil((deadline - Date.now()) / (24 * 60 * 60 * 1000));
}

function GdprTab() {
  const [items, setItems] = useState<GdprRequest[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  function refresh() {
    fetch('/api/backoffice/gdpr').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setItems(body.requests);
    });
  }
  useEffect(refresh, []);

  async function resolve(id: string, decision: 'resolved' | 'rejected') {
    setBusy(id);
    await fetch(`/api/backoffice/gdpr/${id}/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }) });
    setBusy(null); refresh();
  }

  if (err) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!items) return <p className="text-sm text-gray-400">Loading…</p>;
  const pending = items.filter((r) => r.status === 'pending').sort((a, b) => a.created_at.localeCompare(b.created_at));
  const past = items.filter((r) => r.status !== 'pending');
  const overdueCount = pending.filter((r) => daysLeft(r.created_at) <= 7).length;

  return (
    <Card title={`GDPR / RGPD requests (${pending.length})`} tint={overdueCount > 0 ? 'red' : undefined}>
      <p className="mb-3 text-xs text-gray-500">
        Legal deadline is {GDPR_DEADLINE_DAYS} days from submission. &quot;Erase&quot; nulls PII on every matched people row across every org.
      </p>
      {pending.length === 0 ? <p className="text-sm text-gray-400">Queue clear.</p> : (
        <ul className="space-y-2">
          {pending.map((r) => {
            const left = daysLeft(r.created_at);
            const deadlineClass = left <= 7 ? 'text-[#B00000] font-semibold' : left <= 14 ? 'text-amber-600 font-semibold' : 'text-gray-400';
            return (
              <li key={r.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${r.kind === 'erase' ? 'bg-red-100 text-red-800' : 'bg-cyan-100 text-cyan-800'}`}>{r.kind}</span>
                  <span className="font-medium">{r.claimant_name || r.claimant_email}</span>
                  <span className="text-xs text-gray-400">{r.claimant_email}</span>
                  <span className={`ml-auto text-xs ${deadlineClass}`}>{left < 0 ? `${-left}d overdue` : `${left}d left`}</span>
                </div>
                {r.details && <p className="mt-1 text-xs text-gray-600">{r.details}</p>}
                <div className="mt-1 text-xs text-gray-400">
                  {r.matches.length === 0 ? 'No matching record found by email — link manually if needed.' : `Matches: ${r.matches.map((m) => `${m.name} (${m.orgName})`).join(', ')}`}
                </div>
                <div className="mt-2 flex gap-2">
                  <Tooltip text={r.kind === 'erase' ? 'Nulls out PII on every matched person record across every org — irreversible.' : 'Marks this rectification request as handled.'}>
                    <button disabled={busy === r.id} onClick={() => resolve(r.id, 'resolved')} className="rounded bg-green-700 px-2 py-1 text-xs font-medium text-white hover:bg-green-800 disabled:opacity-40">
                      {r.kind === 'erase' ? 'Erase & resolve' : 'Mark resolved'}
                    </button>
                  </Tooltip>
                  <Tooltip text="Declines the request — no data is changed.">
                    <button disabled={busy === r.id} onClick={() => resolve(r.id, 'rejected')} className="rounded border border-red-200 px-2 py-1 text-xs text-[#B00000] hover:bg-red-50 disabled:opacity-40">Reject</button>
                  </Tooltip>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {past.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-gray-400">Decided ({past.length})</summary>
          <ul className="mt-2 space-y-1 text-xs">
            {past.map((r) => (
              <li key={r.id} className="flex items-center gap-2">
                <span className={`rounded-full px-1.5 py-0.5 font-semibold ${r.status === 'resolved' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{r.status}</span>
                <span>{r.kind} — {r.claimant_email}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

// Identity verification Fase A (prompt 63) — one queue for the two things
// that make a catalog_entities row 'verified': an investor-proposed new
// firm (Bloco 1), or an uploaded document against an existing/new firm
// (Bloco 3). Same Card/Tooltip/Approve-Reject shape as SubmissionsTab above.
interface PendingEntity { id: string; catalogEntityId: string; addedByEmail: string; createdAt: string; entityName: string; website: string | null }
interface PendingDocument { id: string; investorEmail: string; catalogEntityId: string; fileName: string; createdAt: string; entityName: string; url: string | null }

function InvestorIdentityTab() {
  const [pendingEntities, setPendingEntities] = useState<PendingEntity[] | null>(null);
  const [documents, setDocuments] = useState<PendingDocument[] | null>(null);
  const [err, setErr] = useState('');

  function refresh() {
    fetch('/api/backoffice/investor-identity').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setPendingEntities(body.pendingEntities ?? []);
      setDocuments(body.documents ?? []);
    });
  }
  useEffect(refresh, []);

  async function reviewEntity(catalogEntityId: string, decision: 'approved' | 'rejected') {
    await fetch(`/api/backoffice/investor-identity/entities/${catalogEntityId}/review`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }),
    });
    refresh();
  }
  async function reviewDocument(id: string, decision: 'approved' | 'rejected') {
    await fetch(`/api/backoffice/investor-identity/documents/${id}/review`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }),
    });
    refresh();
  }

  if (err) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!pendingEntities || !documents) return <p className="text-sm text-gray-400">Loading…</p>;

  return (
    <div className="space-y-4">
      <Card title={`Firms investors added themselves (${pendingEntities.length})`}>
        <p className="mb-3 text-xs text-gray-500">
          &quot;My firm isn&apos;t listed&quot; (Prompt 63 Bloco 1). Approving marks the catalog entity verified — every investor
          linked to it shows the &quot;Verified fund&quot; badge, not just the one who added it.
        </p>
        {pendingEntities.length === 0 ? <p className="text-sm text-gray-400">Queue clear.</p> : (
          <ul className="space-y-2">
            {pendingEntities.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 p-3 text-sm">
                <span className="font-medium">{e.entityName}</span>
                {e.website && <a href={e.website} target="_blank" rel="noreferrer" className="text-xs text-[#0E7490] hover:underline">{e.website}</a>}
                <span className="text-xs text-gray-400">added by {e.addedByEmail} · {e.createdAt.slice(0, 10)}</span>
                <div className="ml-auto flex gap-2">
                  <button onClick={() => reviewEntity(e.catalogEntityId, 'approved')} className="rounded bg-green-700 px-2 py-1 text-xs font-medium text-white hover:bg-green-800">Verify</button>
                  <button onClick={() => reviewEntity(e.catalogEntityId, 'rejected')} className="rounded border border-red-200 px-2 py-1 text-xs text-[#B00000] hover:bg-red-50">Reject</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`Verification documents (${documents.length})`}>
        <p className="mb-3 text-xs text-gray-500">
          Uploaded incorporation/registry documents (Prompt 63 Bloco 3). Approving verifies the linked catalog entity.
        </p>
        {documents.length === 0 ? <p className="text-sm text-gray-400">Queue clear.</p> : (
          <ul className="space-y-2">
            {documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 p-3 text-sm">
                <span className="font-medium">{d.entityName}</span>
                <span className="text-xs text-gray-500">{d.investorEmail}</span>
                {d.url ? <a href={d.url} target="_blank" rel="noreferrer" className="text-xs text-[#0E7490] hover:underline">{d.fileName}</a> : <span className="text-xs text-gray-400">{d.fileName}</span>}
                <span className="text-xs text-gray-400">{d.createdAt.slice(0, 10)}</span>
                <div className="ml-auto flex gap-2">
                  <button onClick={() => reviewDocument(d.id, 'approved')} className="rounded bg-green-700 px-2 py-1 text-xs font-medium text-white hover:bg-green-800">Verify</button>
                  <button onClick={() => reviewDocument(d.id, 'rejected')} className="rounded border border-red-200 px-2 py-1 text-xs text-[#B00000] hover:bg-red-50">Reject</button>
                </div>
              </li>
            ))}
          </ul>
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
};
type ResearchResult = {
  status: 'loading' | 'not_configured' | 'error' | 'done';
  message?: string;
  proposals?: { field: string; value: string; confidence: number; source_url: string }[];
  appliedToOrgs?: number;
};

function EnrichmentQueueTable({ title, subtitle, emptyLabel, queue, research, onResearch }: {
  title: string; subtitle: string; emptyLabel: string; queue: EnrichmentRow[];
  research: Record<string, ResearchResult>; onResearch: (subjectType: 'entity' | 'person', name: string) => void;
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
                  <td className="py-2 font-medium">{r.name}</td>
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
                          ? <div className="text-cyan-800">{rr.proposals.length} field(s) proposed → queued for {rr.appliedToOrgs} org(s).</div>
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

  useEffect(() => {
    fetch('/api/backoffice/enrichment').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setProfileQueue(body.profileQueue);
      setContactQueue(body.contactQueue);
    });
  }, []);

  async function researchRow(subjectType: 'entity' | 'person', name: string) {
    const key = `${subjectType}:${name}`;
    setResearch((prev) => ({ ...prev, [key]: { status: 'loading' } }));
    try {
      const res = await fetch('/api/backoffice/research', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subjectType, name }) });
      const body = await res.json();
      if (body.configured === false) setResearch((prev) => ({ ...prev, [key]: { status: 'not_configured', message: body.message } }));
      else if (body.ok === false) setResearch((prev) => ({ ...prev, [key]: { status: 'error', message: body.error } }));
      else setResearch((prev) => ({ ...prev, [key]: { status: 'done', proposals: body.proposals, appliedToOrgs: body.appliedToOrgs, message: body.message } }));
    } catch (e) {
      setResearch((prev) => ({ ...prev, [key]: { status: 'error', message: (e as Error).message } }));
    }
  }

  if (err) return <Card title="Quality — enrichment queue"><p className="text-sm text-[#B00000]">{err}</p></Card>;
  if (!profileQueue || !contactQueue) return <Card title="Quality — enrichment queue"><p className="text-sm text-gray-400">Loading…</p></Card>;

  return (
    <div className="space-y-4">
      <EnrichmentQueueTable
        title="Quality — profiles below 70% (firmographic)"
        subtitle="Ranked by demand. &quot;Research with AI&quot; proposes fields with source + confidence, queued for verification in Queue → Contributions."
        emptyLabel="Nothing below the firmographic completeness threshold right now."
        queue={profileQueue} research={research} onResearch={researchRow}
      />
      <EnrichmentQueueTable
        title="Quality — contact gaps"
        subtitle="Entities already firmographically solid (≥70%) but with zero contact fields on file — the actionable follow-up list for the direct-research program."
        emptyLabel="No firmographically-qualified entity has zero contact data right now."
        queue={contactQueue} research={research} onResearch={researchRow}
      />
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
    ['Sectors', manual.sectors.join(', ') || '—', catalogEntity.sectors.join(', ') || '—'],
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
function AddedByStartupsTab({ catalog, onPromoted }: { catalog: CatalogEntity[]; onPromoted: () => void }) {
  const [rows, setRows] = useState<ManualEntity[] | null>(null);
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, string>>({});
  const [compareId, setCompareId] = useState<string | null>(null);
  const [contactsId, setContactsId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState('');
  // Prompt 276 — 'all' shows every row; a letter shows that grade AND
  // anything better (e.g. 'B' shows A and B), matching "aprova A e B de
  // uma vez" rather than exactly-this-grade-only.
  const [minGrade, setMinGrade] = useState<CompletenessGrade | 'all'>('all');

  const graded = useMemo(() => {
    const m = new Map<string, ReturnType<typeof manualEntityCompleteness>>();
    for (const r of rows ?? []) {
      m.set(r.id, manualEntityCompleteness({
        website: r.website, hqCity: r.hqCity, hqCountry: r.hqCountry, geographies: r.geographies,
        stageMin: r.stageMin, stageMax: r.stageMax, checkMinEur: r.checkMinEur, checkMaxEur: r.checkMaxEur,
        sectors: r.sectors, contactCount: r.contacts.length,
      }));
    }
    return m;
  }, [rows]);

  // Prompt 276 §3/§4 — default order becomes grade descending (A first),
  // created_at desc as the tiebreak within the same grade (the API's own
  // order, preserved exactly where grade doesn't distinguish two rows).
  // Filtered to minGrade first so "select all" below only ever touches
  // what's actually on screen, never all 757 regardless of the filter.
  const visibleRows = useMemo(() => {
    if (!rows) return [];
    const list = minGrade === 'all' ? rows : rows.filter((r) => (graded.get(r.id)?.grade ?? 'E').localeCompare(minGrade) <= 0);
    return [...list].sort((a, b) =>
      (graded.get(a.id)?.grade ?? 'E').localeCompare(graded.get(b.id)?.grade ?? 'E') || b.createdAt.localeCompare(a.createdAt));
  }, [rows, graded, minGrade]);

  function refresh() {
    fetch('/api/backoffice/catalog/manual-entities').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setRows(body.manualEntities);
      // Prompt 191 §E — a row that's gone after refresh (promoted/merged/
      // dismissed elsewhere, or by a teammate) shouldn't linger selected.
      setSelectedIds((prev) => new Set([...prev].filter((id) => (body.manualEntities as ManualEntity[]).some((r) => r.id === id))));
    });
  }
  useEffect(refresh, []);

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  // Prompt 276 §4 — operates on visibleRows (post-filter), not the full
  // 757: toggles only the rows currently on screen, leaving any selection
  // made under a DIFFERENT filter (e.g. grade A selected, then switched to
  // viewing grade B) untouched rather than clobbering it.
  function toggleSelectAll() {
    if (visibleRows.length === 0) return;
    const allVisibleSelected = visibleRows.every((r) => selectedIds.has(r.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const r of visibleRows) { if (allVisibleSelected) next.delete(r.id); else next.add(r.id); }
      return next;
    });
  }

  async function dismiss(row: ManualEntity) {
    setBusyId(row.id);
    const res = await fetch(`/api/backoffice/catalog/manual-entities/${row.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dismiss: true }),
    });
    const body = await res.json();
    setBusyId(null);
    if (body.ok === false) { setResult((prev) => ({ ...prev, [row.id]: body.error })); return; }
    refresh();
  }

  // Prompt 191 §C — one action, the row's own likelyDuplicate decides
  // merge vs. promote, exactly what the two old per-row buttons did.
  async function addSelectedToCatalog() {
    const ids = [...selectedIds];
    if (ids.length === 0 || !rows) return;
    setBulkBusy(true); setBulkResult('');
    const outcomes = await Promise.all(ids.map(async (id) => {
      const row = rows.find((r) => r.id === id);
      if (!row) return { id, ok: true }; // already gone — nothing to do
      if (row.likelyDuplicate) {
        const res = await fetch('/api/backoffice/catalog/merge', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keepId: row.likelyDuplicate.catalogId, manualEntityId: row.id }),
        });
        const body = await res.json();
        return { id, ok: body.ok !== false, error: body.ok === false ? body.error : undefined };
      }
      const res = await fetch('/api/backoffice/catalog/promote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ manualEntityId: row.id }),
      });
      const body = await res.json();
      return { id, ok: body.ok !== false, error: body.ok === false ? body.error : undefined };
    }));
    setBulkBusy(false);
    const failed = outcomes.filter((o) => !o.ok);
    setBulkResult(failed.length === 0
      ? `Added ${outcomes.length} entit${outcomes.length === 1 ? 'y' : 'ies'} to the catalog.`
      : `Added ${outcomes.length - failed.length} of ${outcomes.length}; ${failed.length} failed — see the row(s) below.`);
    setResult((prev) => {
      const next = { ...prev };
      for (const o of failed) if (o.error) next[o.id] = o.error;
      return next;
    });
    setSelectedIds(new Set());
    refresh(); onPromoted();
  }

  if (err) return <Card title="Added by startups"><p className="text-sm text-[#B00000]">{err}</p></Card>;
  if (!rows) return <Card title="Added by startups"><p className="text-sm text-gray-400">Loading…</p></Card>;

  return (
    <Card title={`Added by startups (${rows.length})`}>
      <p className="mb-3 text-xs text-gray-500">
        Every investor a founder added manually (any org), cross-checked against the shared catalog by domain, name,
        and known aliases. Fix any field that looks wrong before adding it — the correction is saved on the
        founder&apos;s own record and carries through to whatever you add next. Select rows and add them to the
        catalog in one go: a flagged row merges into its likely match (filling gaps only, never overwriting), an
        unflagged row is promoted as a new entry. Dismiss a row that isn&apos;t worth either.
      </p>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button disabled={selectedIds.size === 0 || bulkBusy} onClick={addSelectedToCatalog}
          className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
          {bulkBusy ? 'Adding…' : `Add selected to catalog (${selectedIds.size})`}
        </button>
        {bulkResult && <span className="text-xs text-gray-500">{bulkResult}</span>}
        {/* Prompt 276 §4 — "minimum grade" (A/B/... and better), not an
            exact-grade filter: the point is "show me the richest rows so
            I can select-all and approve them together", which a
            single-grade-only filter would make into several separate
            select-all passes for no benefit. */}
        <label className="ml-auto text-xs text-gray-500">Minimum grade
          <select value={minGrade} onChange={(e) => setMinGrade(e.target.value as CompletenessGrade | 'all')}
            className="ml-1.5 rounded border border-gray-300 px-1.5 py-1 text-xs">
            <option value="all">All</option>
            {(['A', 'B', 'C', 'D', 'E'] as const).map((g) => <option key={g} value={g}>{g} or better</option>)}
          </select>
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
              <th className="w-8 py-1.5"><input type="checkbox" checked={visibleRows.length > 0 && visibleRows.every((r) => selectedIds.has(r.id))} onChange={toggleSelectAll} /></th>
              <th>Grade</th>
              <th>Startup org</th><th>Investor</th><th>HQ</th><th>Geographies</th><th>Stage</th><th>Sectors</th><th>Contact</th><th>Match</th><th></th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((r) => {
              const catalogEntity = r.likelyDuplicate ? catalog.find((c) => c.id === r.likelyDuplicate!.catalogId) : undefined;
              const g = graded.get(r.id);
              return (
                <Fragment key={r.id}>
                  <tr className="border-t border-gray-50 align-top">
                    <td className="py-2"><input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggleSelected(r.id)} /></td>
                    <td>{g && <GradeBadge grade={g.grade} percent={g.percent} />}</td>
                    <td className="text-gray-500">{r.orgName}</td>
                    <td className="font-medium">{r.name}{r.website && <div className="text-xs font-normal text-gray-400">{r.website}</div>}</td>
                    <td className="text-gray-500">{[r.hqCity, r.hqCountry].filter(Boolean).join(', ') || '—'}</td>
                    <td className="max-w-[160px] text-xs text-gray-500">{r.geographies?.length ? r.geographies.join(', ') : '—'}</td>
                    <td className="text-gray-500">{fmtStage(r.stageMin, r.stageMax)}</td>
                    <td className="max-w-[200px] text-xs text-gray-500">{r.sectors.length ? r.sectors.join(', ') : '—'}</td>
                    <td className="text-xs text-gray-500">{[r.email, r.phone].filter(Boolean).join(' · ') || '—'}</td>
                    <td>
                      {r.likelyDuplicate ? (
                        <button onClick={() => setCompareId(compareId === r.id ? null : r.id)}
                          className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 hover:bg-amber-100"
                          title={`Matched by ${r.likelyDuplicate.reason}`}>
                          Likely duplicate: {r.likelyDuplicate.catalogEntity.name}
                        </button>
                      ) : <span className="text-xs text-gray-300">No match</span>}
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <button onClick={() => setEditId(editId === r.id ? null : r.id)} className="mr-2 text-xs text-cyan-700 hover:underline">
                        {editId === r.id ? 'Close' : 'Edit'}
                      </button>
                      <button onClick={() => setContactsId(contactsId === r.id ? null : r.id)} className="mr-2 text-xs text-cyan-700 hover:underline">
                        {contactsId === r.id ? 'Close' : `Contacts (${r.contacts.length})`}
                      </button>
                      <button disabled={busyId === r.id} onClick={() => dismiss(r)} className="text-xs text-gray-400 hover:underline disabled:opacity-40">Dismiss</button>
                    </td>
                  </tr>
                  {editId === r.id && (
                    <tr className="border-t border-gray-50">
                      <td colSpan={11} className="py-2">
                        <ManualEntityEditForm row={r} onCancel={() => setEditId(null)} onSaved={() => { setEditId(null); refresh(); }} />
                      </td>
                    </tr>
                  )}
                  {contactsId === r.id && (
                    <tr className="border-t border-gray-50"><td colSpan={11} className="py-2"><ManualEntityContactsPanel contacts={r.contacts} /></td></tr>
                  )}
                  {compareId === r.id && catalogEntity && (
                    <tr className="border-t border-gray-50"><td colSpan={11} className="py-2"><CompareTable manual={r} catalogEntity={catalogEntity} /></td></tr>
                  )}
                  {result[r.id] && (
                    <tr><td colSpan={11} className="pb-2 text-xs text-gray-500">{result[r.id]}</td></tr>
                  )}
                </Fragment>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={11} className="py-4 text-center text-sm text-gray-400">No manually-added investors from startups yet.</td></tr>}
            {rows.length > 0 && visibleRows.length === 0 && <tr><td colSpan={11} className="py-4 text-center text-sm text-gray-400">No rows at grade {minGrade} or better.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// Prompt 190 — wraps AddedByStartupsTab + QualityPanel for this tab.
// Fetches its own catalog copy rather than threading it down from
// BackofficeQueuePage (which has nothing else in common with Catalog data)
// — the prompt's own text explicitly leaves this as an implementation
// choice ("ou o componente busca a sua própria cópia, se for mais simples
// do que passar por props entre páginas").
function CatalogCandidatesTab() {
  const [catalog, setCatalog] = useState<CatalogEntity[] | null>(null);
  const [err, setErr] = useState('');

  function refresh() {
    fetch('/api/backoffice/catalog').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setCatalog(body.catalog);
    });
  }
  useEffect(refresh, []);

  return (
    <div className="space-y-4">
      {err && <p className="text-sm text-[#B00000]">{err}</p>}
      {catalog && <AddedByStartupsTab catalog={catalog} onPromoted={refresh} />}
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

  function refresh() {
    fetch('/api/backoffice/key-people-promote').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      const list = body.items as KeyPeopleCandidate[];
      setItems(list);
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

export default function BackofficeQueuePage() {
  const [tab, setTab] = useState<Tab>('contributions');
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
      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm font-medium ${tab === t.key ? 'border-b-2 border-[#0E7490] text-[#0E7490]' : 'text-gray-400 hover:text-gray-600'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'contributions' && <ContributionsTab />}
      {tab === 'candidates' && <CatalogCandidatesTab />}
      {tab === 'submissions' && <SubmissionsTab />}
      {tab === 'claims' && <ClaimsTab />}
      {tab === 'identity' && <InvestorIdentityTab />}
      {tab === 'gdpr' && <GdprTab />}
      {tab === 'suspicious' && <SuspiciousAccountsTab />}
      {tab === 'key_people' && <KeyPeoplePromoteTab />}
      {tab === 'community' && <ContributionsByUsersTab />}
    </div>
  );
}
