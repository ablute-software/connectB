'use client';
// BLOCO 3 — Catálogo: catalog_entities CRUD, the merge-duplicates tool
// (§9b-3, "ferramenta prioritária"), packs, and the cross-org distribution
// log.
//
// Prompt 187 added filters + a per-row contacts panel here (both stay).
// Prompt 187 also added an "Added by startups" tab + the Quality panel
// folded into it — Prompt 190 moved BOTH out to backoffice/queue (a new
// "Catalog candidates" tab, alongside Contributions) per Nuno's explicit
// decision that review work belongs in the Queue, not hidden inside
// Catalog. This page is back to a single view, same as before 187.
import { Fragment, Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams, usePathname, useRouter } from 'next/navigation';
import { Card } from '@/components/ui';
import { EnrichmentCampaignPanel } from '@/components/backoffice/EnrichmentCampaignPanel';
import { OutreachSupplyCard } from '@/components/backoffice/OutreachSupplyCard';
import { AccountActionPanel } from '@/components/backoffice/AccountActionPanel';
import type { DupMatch, MatchReason } from '@/lib/catalog-dedupe';
import { useTableUrlState } from '@/lib/use-table-url-state';
import { PAGE_SIZES, pageCount, rangeLabel, type ColumnSortType } from '@/lib/queue-table-state';
import { sortRows } from '@/lib/table-sort';

type ContactRow = {
  id: string; fullName: string; linkedinUrl: string | null; hookStatus: string;
  doNotContact: boolean; title: string | null; isPrimary: boolean;
};

type CatalogEntity = {
  id: string; name: string; type: string; hq_city: string | null; hq_country: string | null;
  sectors: string[]; website: string | null; verification_status: 'verified' | 'pending' | 'rejected';
  verified_at: string | null; source: string; notes: string | null; aliases: string[];
  stage_min: string | null; stage_max: string | null; check_min_eur: number | null; check_max_eur: number | null;
  geographies: string[] | null; contacts: ContactRow[]; created_at: string;
};

// Prompt 580 §B.2/§B.3 — the merge tool's own per-candidate weight, from
// /api/backoffice/catalog/dedupe (not present on CatalogEntity generally;
// only the merge-duplicates cluster response carries these three counts).
type DedupeMember = CatalogEntity & { deliveries: number; packs: number; aliasCount: number };
type DupCluster = { reasons: MatchReason[]; matches: DupMatch[]; suspicious: boolean; members: DedupeMember[] };

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

// Prompt 191 §D — the org name already lives in the free-text `notes`
// field (promote/route.ts and merge/route.ts's manual branch both now
// write "Added by startup {name}. (...)" as the first sentence) rather
// than a new structured column — the prompt's own diagnosis was that this
// data already existed and just needed surfacing, not a new field to
// carry it. Falls back to a generic label for rows written before this
// prompt (old format led with the org's UUID, which this doesn't match).
function extractProvenanceOrgName(notes: string | null): string | null {
  // Matches up to the literal ". (" that always precedes the parenthetical
  // debug trail in promote/route.ts and merge/route.ts's own fixed format
  // — not just the first period, which would truncate any org name that
  // itself contains one (e.g. "Foo Inc.").
  return notes?.match(/^Added by startup (.+)\. \(/)?.[1] ?? null;
}

// Prompt 580 §B.2 — verified first; without one, whichever candidate has
// more real-world weight already attached (deliveries + packs + aliases —
// the same three things merge/route.ts itself repoints or deletes, never a
// score invented separately from what the merge actually touches).
function pickDefaultKeeper(members: DedupeMember[]): string {
  const verified = members.find((m) => m.verification_status === 'verified');
  if (verified) return verified.id;
  return [...members].sort((a, b) =>
    (b.deliveries + b.packs + b.aliasCount) - (a.deliveries + a.packs + a.aliasCount),
  )[0].id;
}

const REASON_LABEL: Record<MatchReason, string> = { domain: 'domain', name: 'name', alias: 'alias' };

function MergeDuplicatesTool({ onMerged }: { onMerged: () => void }) {
  const [clusters, setClusters] = useState<DupCluster[] | null>(null);
  const [err, setErr] = useState('');
  const [keepChoice, setKeepChoice] = useState<Record<number, string>>({});
  const [panelFor, setPanelFor] = useState<number | null>(null);
  const [dismissBusy, setDismissBusy] = useState<number | null>(null);
  const [result, setResult] = useState('');

  function refresh() {
    fetch('/api/backoffice/catalog/dedupe').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      const cls = body.clusters as DupCluster[];
      setClusters(cls);
      setKeepChoice(Object.fromEntries(cls.map((cl, i) => [i, pickDefaultKeeper(cl.members)])));
    });
  }
  useEffect(refresh, []);

  function keeperFor(i: number, cl: DupCluster): string {
    return keepChoice[i] ?? cl.members[0].id;
  }
  function isInversion(i: number, cl: DupCluster): boolean {
    const keepId = keeperFor(i, cl);
    const keeper = cl.members.find((m) => m.id === keepId);
    return keeper?.verification_status !== 'verified' && cl.members.some((m) => m.id !== keepId && m.verification_status === 'verified');
  }
  function nameOf(cl: DupCluster, id: string): string {
    return cl.members.find((m) => m.id === id)?.name ?? id;
  }

  async function confirmMerge(i: number, cl: DupCluster, reason: string): Promise<{ ok: boolean; error?: string }> {
    const keepId = keeperFor(i, cl);
    const mergeIds = cl.members.map((m) => m.id).filter((id) => id !== keepId);
    const res = await fetch('/api/backoffice/catalog/merge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keepId, mergeIds, reason, confirmInversion: isInversion(i, cl) }),
    });
    const body = await res.json().catch(() => ({}));
    if (!body.ok) return { ok: false, error: body.error ?? 'Merge failed.' };
    setResult(`Merged ${body.mergedCount} row(s) into the kept entry.${Object.keys(body.conflicts ?? {}).length ? ' Some fields conflicted and were left for manual review — see the audit log.' : ''}`);
    return { ok: true };
  }

  async function dismiss(i: number, cl: DupCluster) {
    const reason = window.prompt('Why are these not duplicates?')?.trim();
    if (!reason) return;
    setDismissBusy(i); setResult('');
    const res = await fetch('/api/backoffice/catalog/dedupe/dismiss', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: cl.members.map((m) => m.id), reason }),
    });
    const body = await res.json().catch(() => ({}));
    setDismissBusy(null);
    if (!body.ok) { setResult(body.error); return; }
    setResult(`Dismissed. Removed ${body.removedAliases} linking alias(es).`);
    refresh();
  }

  if (err) return <Card title="Merge duplicates"><p className="text-sm text-[#B00000]">{err}</p></Card>;
  if (!clusters) return <Card title="Merge duplicates"><p className="text-sm text-gray-400">Scanning…</p></Card>;

  // Prompt 580 §B.5 — "(3)" used to mean 3 groups while showing 4 rows in
  // one of them; both numbers now, always.
  const totalFirms = clusters.reduce((s, cl) => s + cl.members.length, 0);
  const countLabel = clusters.length === 0 ? '0' : `${clusters.length} group${clusters.length === 1 ? '' : 's'} · ${totalFirms} firm${totalFirms === 1 ? '' : 's'}`;

  return (
    <Card title={`Merge duplicates (${countLabel})`} tint={clusters.length > 0 ? 'amber' : undefined}>
      <p className="mb-3 text-xs text-gray-500">
        Matched by normalized website domain, normalized name (diacritics/legal-suffix/parenthetical stripped), and known aliases.
      </p>
      {result && <p className="mb-2 text-xs text-cyan-800">{result}</p>}
      {clusters.length === 0 ? <p className="text-sm text-gray-400">No likely duplicates found.</p> : (
        <div className="space-y-3">
          {clusters.map((cl, i) => {
            const keepId = keeperFor(i, cl);
            const losers = cl.members.filter((m) => m.id !== keepId);
            const totalDeliveries = losers.reduce((s, m) => s + m.deliveries, 0);
            const totalPacks = losers.reduce((s, m) => s + m.packs, 0);
            const totalAliases = losers.reduce((s, m) => s + m.aliasCount, 0);
            const cascadeLines = [
              `Deletes ${losers.length} catalog ${losers.length === 1 ? 'entry' : 'entries'}: ${losers.map((m) => m.name).join(', ')}.`,
              `Repoints ${totalDeliveries} catalog deliveries (founder pipelines) to the kept entry.`,
              `Repoints ${totalPacks} pack reference${totalPacks === 1 ? '' : 's'}.`,
              `Adds ${losers.length} name${losers.length === 1 ? '' : 's'} and ${totalAliases} existing alias(es) as new aliases of the kept entry.`,
              ...(isInversion(i, cl) ? ['⚠ Merges a VERIFIED entry into a pending one.'] : []),
            ];
            return (
              <div key={i} className={`rounded-xl border p-3 ${cl.suspicious ? 'border-[#B00000]/40 bg-red-50/40' : 'border-amber-200 bg-amber-50/50'}`}>
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-amber-800">
                  <span>Matched by: {cl.reasons.map((r) => REASON_LABEL[r]).join(', ')}</span>
                  {cl.suspicious && (
                    <span className="rounded-full bg-[#B00000] px-2 py-0.5 text-[10px] font-bold uppercase text-white" title="More than 3 firms joined at least partly through an alias — the exact shape of the 2026-08-13 incident. Check each edge below before merging.">
                      ⚠ Check aliases
                    </span>
                  )}
                </div>
                {/* Prompt 580 §B.4 — which alias/name/domain linked which two
                    firms specifically, not just a group-wide flag with no
                    detail — this is what would have made the 08/13 mistake
                    visible at a glance instead of looking like one strong match. */}
                {cl.matches.length > 0 && (
                  <ul className="mb-2 space-y-0.5 text-[11px] text-gray-500">
                    {cl.matches.map((m, mi) => (
                      <li key={mi}>
                        {m.ids.map((id) => nameOf(cl, id)).join(' ↔ ')} — matched by {REASON_LABEL[m.reason]} &lsquo;{m.value}&rsquo;
                      </li>
                    ))}
                  </ul>
                )}
                <ul className="space-y-1 text-sm">
                  {cl.members.map((m) => (
                    <li key={m.id} className="flex items-center gap-2">
                      <input type="radio" name={`keep-${i}`} checked={keepId === m.id}
                        onChange={() => setKeepChoice({ ...keepChoice, [i]: m.id })} />
                      <span className="font-medium">{m.name}</span>
                      {m.website && <span className="text-xs text-gray-400">{m.website}</span>}
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${m.verification_status === 'verified' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{m.verification_status}</span>
                      <span className="text-[10px] text-gray-400">{m.deliveries} deliveries · {m.packs} packs · {m.aliasCount} aliases</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex gap-2">
                  <button onClick={() => setPanelFor(i)}
                    className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-40">
                    Merge into selected
                  </button>
                  {/* Prompt 580 §B.1 — the button the tool never had: the
                      exact 4-firm group named in this prompt could only ever
                      be merged, never dismissed as unrelated. */}
                  <button disabled={dismissBusy === i} onClick={() => void dismiss(i, cl)}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                    {dismissBusy === i ? 'Dismissing…' : 'Not duplicates'}
                  </button>
                </div>
                {panelFor === i && (
                  <AccountActionPanel title="Merge" name={`Keep: ${nameOf(cl, keepId)}`}
                    cascadeLines={cascadeLines} confirmLabel="Confirm merge"
                    reasonPlaceholder="Why are these the same firm?"
                    onConfirm={(reason) => confirmMerge(i, cl, reason)}
                    onClose={() => setPanelFor(null)}
                    onDone={() => { setPanelFor(null); refresh(); onMerged(); }} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

type OrgAction = {
  id: string; action_type: string; starts_at: string; ends_at: string | null;
  value: string | null; reason: string; status: 'active' | 'expired' | 'revoked'; created_at: string;
};

const ACTION_TYPE_LABELS: Record<string, string> = {
  discount: 'Discount', extension: 'Extension', pack_unlock: 'Pack unlock',
  feature_unlock: 'Feature unlock', flag_commercial_contact: 'Flagged for commercial contact', other: 'Other',
};

// SherlockDeal_Metricas_BackOffice_V1, Section 1.2 — the actions the doc
// asks to be able to apply from customer assistance (discount, extension,
// pack/feature unlock, flag for commercial contact), scoped to a catalog
// investor org. Verify/reject/claim/access-request approval already exist
// elsewhere in the backoffice — this fills the one gap: benefits that
// aren't a yes/no decision on an existing request.
function OrgActionsPanel({ orgRefId }: { orgRefId: string }) {
  const [actions, setActions] = useState<OrgAction[] | null>(null);
  const [actionType, setActionType] = useState('discount');
  const [value, setValue] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  function refresh() {
    fetch(`/api/backoffice/org-actions?orgType=investor&orgRefId=${orgRefId}`).then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setActions(body.actions);
    });
  }
  useEffect(refresh, [orgRefId]);

  async function grant() {
    if (!reason.trim()) { setErr('A reason is required.'); return; }
    setBusy(true); setErr('');
    const res = await fetch('/api/backoffice/org-actions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgType: 'investor', orgRefId, actionType, value: value || null, endsAt: endsAt || null, reason }),
    });
    const body = await res.json();
    setBusy(false);
    if (body.ok === false) { setErr(body.error); return; }
    setValue(''); setEndsAt(''); setReason(''); refresh();
  }

  async function revoke(id: string) {
    await fetch('/api/backoffice/org-actions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    refresh();
  }

  return (
    <div className="rounded-lg border border-cyan-100 bg-cyan-50/40 p-3 text-sm">
      {err && <p className="mb-2 text-xs text-[#B00000]">{err}</p>}
      {actions === null ? <p className="text-xs text-gray-400">Loading…</p> : actions.length === 0 ? (
        <p className="mb-2 text-xs text-gray-400">No benefits or flags on record for this org.</p>
      ) : (
        <ul className="mb-3 space-y-1">
          {actions.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 text-xs">
              <span className={`rounded-full px-1.5 py-0.5 font-semibold ${a.status === 'active' ? 'bg-cyan-100 text-cyan-800' : 'bg-gray-100 text-gray-400'}`}>
                {ACTION_TYPE_LABELS[a.action_type] ?? a.action_type}
              </span>
              {a.value && <span className="text-gray-600">{a.value}</span>}
              <span className="text-gray-400">{a.reason}</span>
              {a.ends_at && <span className="text-gray-400">until {a.ends_at.slice(0, 10)}</span>}
              <span className="text-gray-300">{a.created_at.slice(0, 10)}</span>
              {a.status === 'active' && <button onClick={() => revoke(a.id)} className="text-[#B00000] hover:underline">Revoke</button>}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <select value={actionType} onChange={(e) => setActionType(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1 text-xs">
          {Object.entries(ACTION_TYPE_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <input placeholder="Value (e.g. 20%)" value={value} onChange={(e) => setValue(e.target.value)} className="w-28 rounded-lg border border-gray-300 px-2 py-1 text-xs" />
        <input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} title="Ends at (optional)" className="rounded-lg border border-gray-300 px-2 py-1 text-xs" />
        <input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} className="min-w-[160px] flex-1 rounded-lg border border-gray-300 px-2 py-1 text-xs" />
        <button disabled={busy} onClick={grant} className="rounded-lg bg-cyan-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-cyan-800 disabled:opacity-40">
          {busy ? 'Saving…' : 'Grant'}
        </button>
      </div>
    </div>
  );
}

// Prompt 187 §C — manual contact management for one catalog row. Edits go
// through /people (name/linkedin/title only — hook_status/do_not_contact
// stay owned by the enrichment pipeline). "Remove" deletes only this
// entity's affiliation, never the catalog_people row itself.
function ContactsPanel({ entityId, contacts, refresh }: { entityId: string; contacts: ContactRow[]; refresh: () => void }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editLinkedin, setEditLinkedin] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [newName, setNewName] = useState('');
  const [newLinkedin, setNewLinkedin] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  function startEdit(c: ContactRow) {
    setEditingId(c.id); setEditName(c.fullName); setEditLinkedin(c.linkedinUrl ?? ''); setEditTitle(c.title ?? '');
  }

  async function saveEdit() {
    if (!editingId) return;
    setBusy(true); setErr('');
    const res = await fetch(`/api/backoffice/catalog/people/${editingId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: editName, linkedinUrl: editLinkedin, title: editTitle, entityId }),
    });
    const body = await res.json();
    setBusy(false);
    if (body.ok === false) { setErr(body.error); return; }
    setEditingId(null); refresh();
  }

  async function removeContact(personId: string) {
    setBusy(true);
    await fetch(`/api/backoffice/catalog/people/${personId}?entityId=${entityId}`, { method: 'DELETE' });
    setBusy(false); refresh();
  }

  async function addContact() {
    if (!newName.trim()) return;
    setBusy(true); setErr('');
    const res = await fetch('/api/backoffice/catalog/people', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityId, fullName: newName, linkedinUrl: newLinkedin || undefined, title: newTitle || undefined }),
    });
    const body = await res.json();
    setBusy(false);
    if (body.ok === false) { setErr(body.error); return; }
    setNewName(''); setNewLinkedin(''); setNewTitle(''); refresh();
  }

  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-3 text-sm">
      {err && <p className="mb-2 text-xs text-[#B00000]">{err}</p>}
      {contacts.length === 0 ? <p className="mb-2 text-xs text-gray-400">No contacts on file.</p> : (
        <ul className="mb-3 space-y-1.5">
          {contacts.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 text-xs">
              {editingId === c.id ? (
                <>
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} className="w-36 rounded border border-gray-300 px-1.5 py-0.5" />
                  <input placeholder="Title" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="w-28 rounded border border-gray-300 px-1.5 py-0.5" />
                  <input placeholder="LinkedIn URL" value={editLinkedin} onChange={(e) => setEditLinkedin(e.target.value)} className="w-48 rounded border border-gray-300 px-1.5 py-0.5" />
                  <button disabled={busy} onClick={saveEdit} className="text-cyan-700 hover:underline">Save</button>
                  <button onClick={() => setEditingId(null)} className="text-gray-400 hover:underline">Cancel</button>
                </>
              ) : (
                <>
                  <span className="font-medium">{c.fullName}</span>
                  {c.title && <span className="text-gray-400">{c.title}</span>}
                  {c.isPrimary && <span className="rounded-full bg-cyan-50 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-700">Primary</span>}
                  {c.linkedinUrl && <a href={c.linkedinUrl} target="_blank" rel="noreferrer" className="text-cyan-700 hover:underline">LinkedIn</a>}
                  {c.doNotContact && <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">Do not contact</span>}
                  <button onClick={() => startEdit(c)} className="text-gray-500 hover:underline">Edit</button>
                  <button disabled={busy} onClick={() => removeContact(c.id)} className="text-[#B00000] hover:underline">Remove</button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <input placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} className="w-36 rounded-lg border border-gray-300 px-2 py-1 text-xs" />
        <input placeholder="Title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} className="w-28 rounded-lg border border-gray-300 px-2 py-1 text-xs" />
        <input placeholder="LinkedIn URL" value={newLinkedin} onChange={(e) => setNewLinkedin(e.target.value)} className="w-48 rounded-lg border border-gray-300 px-2 py-1 text-xs" />
        <button disabled={!newName.trim() || busy} onClick={addContact} className="rounded-lg bg-cyan-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-cyan-800 disabled:opacity-40">Add contact</button>
      </div>
    </div>
  );
}

type CatalogSortKey = 'name' | 'type' | 'hq_country' | 'check_min_eur' | 'stage_min' | 'verification_status' | 'aliasCount';
const CATALOG_COLUMNS: { key: CatalogSortKey; label: string; widthPct: number; type: ColumnSortType }[] = [
  { key: 'name', label: 'Investor', widthPct: 22, type: 'text' },
  { key: 'type', label: 'Type', widthPct: 6, type: 'text' },
  { key: 'hq_country', label: 'HQ', widthPct: 10, type: 'text' },
  { key: 'check_min_eur', label: 'Check', widthPct: 8, type: 'number' },
  { key: 'stage_min', label: 'Stage', widthPct: 8, type: 'text' },
  { key: 'verification_status', label: 'Status', widthPct: 7, type: 'text' },
  { key: 'aliasCount', label: 'Aliases', widthPct: 7, type: 'number' },
];
const CATALOG_COLUMN_TYPES: Record<string, ColumnSortType> = Object.fromEntries(CATALOG_COLUMNS.map((c) => [c.key, c.type]));

// Prompt 582 §B.3 — up to 2 lines of chips by default; "+N more" expands
// the cell in place rather than the old behavior of just letting the text
// wrap however many lines it needed (i5invest: ~40 lines, which is what
// set every OTHER cell in that row to the same height).
function ChipList({ items }: { items: string[] }) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return <span className="text-gray-300">—</span>;
  const shown = expanded ? items : items.slice(0, 4);
  const hidden = items.length - shown.length;
  return (
    <div className={expanded ? '' : 'line-clamp-2'}>
      {shown.map((s, i) => (
        <span key={i} className="mr-1 mb-1 inline-block rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">{s}</span>
      ))}
      {hidden > 0 && (
        <button onClick={() => setExpanded(true)} className="text-[11px] font-medium text-[#0E7490] hover:underline">+{hidden} more</button>
      )}
      {expanded && items.length > 4 && (
        <button onClick={() => setExpanded(false)} className="ml-1 text-[11px] text-gray-400 hover:underline">show less</button>
      )}
    </div>
  );
}

function CatalogTable({ catalog, refresh }: { catalog: CatalogEntity[]; refresh: () => void }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newRow, setNewRow] = useState({ name: '', type: 'vc', website: '' });
  const [creating, setCreating] = useState(false);
  const [openActionsId, setOpenActionsId] = useState<string | null>(null);
  const [openContactsId, setOpenContactsId] = useState<string | null>(null);
  const [showMoreFilters, setShowMoreFilters] = useState(false);

  // Prompt 582 §B.1 — search/filters/sort/page all live in the URL now,
  // the same shape Fase 3 gave Startups/Investors (use-table-url-state.ts,
  // itself built on the Queue's own queue-table-state.ts) — a fourth table
  // reusing the one mechanism rather than a fourth local-state variant.
  const [tableState, setTableState, setSort] = useTableUrlState({
    sortableKeys: CATALOG_COLUMNS.map((c) => c.key), columnTypes: CATALOG_COLUMN_TYPES,
  });
  const f = tableState.filters;
  const setFilter = (key: string, value: string) => setTableState({ filters: { ...f, [key]: value } });

  const typeOptions = useMemo(() => Array.from(new Set(catalog.map((c) => c.type))).sort(), [catalog]);
  const countryOptions = useMemo(() => Array.from(new Set(catalog.map((c) => c.hq_country).filter((v): v is string => !!v))).sort(), [catalog]);
  const geoOptions = useMemo(() => Array.from(new Set(catalog.flatMap((c) => c.geographies ?? []))).sort(), [catalog]);
  const stageOptions = useMemo(() => Array.from(new Set(catalog.flatMap((c) => [c.stage_min, c.stage_max]).filter((v): v is string => !!v))).sort(), [catalog]);
  const sectorOptions = useMemo(() => Array.from(new Set(catalog.flatMap((c) => c.sectors))).sort(), [catalog]);

  const hasFilters = !!(f.type || f.country || f.geo || f.stage || f.sector || f.checkMin || f.checkMax || f.addedFrom);
  function clearFilters() {
    setTableState({ filters: {} });
  }

  function checkMatches(c: CatalogEntity): boolean {
    if (!f.checkMin && !f.checkMax) return true;
    if (c.check_min_eur == null && c.check_max_eur == null) return false;
    const lo = c.check_min_eur ?? c.check_max_eur!;
    const hi = c.check_max_eur ?? c.check_min_eur!;
    const filterLo = f.checkMin ? Number(f.checkMin) : -Infinity;
    const filterHi = f.checkMax ? Number(f.checkMax) : Infinity;
    return hi >= filterLo && lo <= filterHi;
  }

  const q = (f.q ?? '').trim().toLowerCase();
  const filtered = catalog.filter((c) => {
    if (q && !c.name.toLowerCase().includes(q)) return false;
    if (f.type && c.type !== f.type) return false;
    if (f.country && c.hq_country !== f.country) return false;
    if (f.geo && !(c.geographies ?? []).includes(f.geo)) return false;
    if (f.stage && c.stage_min !== f.stage && c.stage_max !== f.stage) return false;
    if (f.sector && !c.sectors.includes(f.sector)) return false;
    if (!checkMatches(c)) return false;
    if (f.addedFrom && f.addedTo && !(c.created_at >= f.addedFrom && c.created_at < f.addedTo)) return false;
    return true;
  });

  const sorted = useMemo(() => {
    if (!tableState.sort) return filtered;
    return sortRows(filtered, tableState.sort, tableState.dir, (row, key) => {
      if (key === 'aliasCount') return row.aliases.length;
      return (row as unknown as Record<string, unknown>)[key];
    });
  }, [filtered, tableState.sort, tableState.dir]);

  const total = sorted.length;
  const totalPages = pageCount(total, tableState.pageSize);
  const page = Math.min(tableState.page, totalPages);
  // Prompt 582 §B — 763 rows today; noted, not solved, for when this stops
  // being true: server-side pagination is worth it once any Accounts/
  // Catalog list nears ~2,000 rows (the same threshold Fase 3 flagged for
  // Startups/Investors) — until then, slicing the already-fetched list is
  // simpler and the route can keep returning everything at once.
  const rows = sorted.slice((page - 1) * tableState.pageSize, page * tableState.pageSize);

  async function create() {
    if (!newRow.name) return;
    setCreating(true);
    await fetch('/api/backoffice/catalog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newRow) });
    setCreating(false); setNewRow({ name: '', type: 'vc', website: '' }); setShowAddForm(false); refresh();
  }
  async function setStatus(id: string, verification_status: 'verified' | 'rejected') {
    await fetch(`/api/backoffice/catalog/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ verification_status }) });
    refresh();
  }
  async function remove(id: string) {
    await fetch(`/api/backoffice/catalog/${id}`, { method: 'DELETE' });
    refresh();
  }

  return (
    <Card title={`Catalog (${rangeLabel({ ...tableState, page }, total)}${total !== catalog.length ? ` of ${catalog.length}` : ''})`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <input placeholder="Search by name…" value={f.q ?? ''} onChange={(e) => setFilter('q', e.target.value)}
          className="w-full max-w-sm rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
        {/* Prompt 582 §B.7 — "Add investor" is a button that opens the same
            three-field form in a panel, instead of the form permanently
            occupying the first row of the page. */}
        <button onClick={() => setShowAddForm((v) => !v)}
          className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0c637b]">
          {showAddForm ? 'Close' : '+ Add investor'}
        </button>
      </div>
      {showAddForm && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-gray-50/60 p-3">
          <input placeholder="New investor name" value={newRow.name} onChange={(e) => setNewRow({ ...newRow, name: e.target.value })}
            className="min-w-[200px] flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
          <select value={newRow.type} onChange={(e) => setNewRow({ ...newRow, type: e.target.value })} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
            {['vc', 'corporate_vc', 'family_office', 'angel_fund', 'angel_network', 'public_body', 'accelerator'].map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>
          <input placeholder="Website" value={newRow.website} onChange={(e) => setNewRow({ ...newRow, website: e.target.value })}
            className="min-w-[160px] rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
          <button disabled={!newRow.name || creating} onClick={create} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
            {creating ? 'Adding…' : 'Add'}
          </button>
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select value={f.type ?? ''} onChange={(e) => setFilter('type', e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1 text-xs">
          <option value="">All types</option>
          {typeOptions.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
        </select>
        <select value={f.country ?? ''} onChange={(e) => setFilter('country', e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1 text-xs">
          <option value="">All HQ countries</option>
          {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={f.stage ?? ''} onChange={(e) => setFilter('stage', e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1 text-xs">
          <option value="">All stages</option>
          {stageOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={() => setShowMoreFilters((v) => !v)} className="text-xs text-[#0E7490] hover:underline">
          {showMoreFilters ? 'Fewer filters' : 'More filters'}
        </button>
        {f.addedFrom && f.addedTo && (
          <span className="flex items-center gap-1.5 rounded-lg bg-[#E8F4F8] px-2 py-1 text-xs text-[#0E7490]">
            Added {f.addedFrom.slice(0, 10)} – {f.addedTo.slice(0, 10)}
            <button onClick={() => setTableState({ filters: { ...f, addedFrom: '', addedTo: '' } })} className="font-bold hover:opacity-70">✕</button>
          </span>
        )}
        {hasFilters && <button onClick={clearFilters} className="text-xs text-gray-400 hover:underline">Clear filters</button>}
      </div>
      {showMoreFilters && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select value={f.geo ?? ''} onChange={(e) => setFilter('geo', e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1 text-xs">
            <option value="">All geographies</option>
            {geoOptions.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <select value={f.sector ?? ''} onChange={(e) => setFilter('sector', e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1 text-xs">
            <option value="">All sectors</option>
            {sectorOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input type="number" placeholder="Check min €" value={f.checkMin ?? ''} onChange={(e) => setFilter('checkMin', e.target.value)} className="w-28 rounded-lg border border-gray-300 px-2 py-1 text-xs" />
          <input type="number" placeholder="Check max €" value={f.checkMax ?? ''} onChange={(e) => setFilter('checkMax', e.target.value)} className="w-28 rounded-lg border border-gray-300 px-2 py-1 text-xs" />
        </div>
      )}
      {/* Prompt 582 §B.4 — the ONE scrollbar this card is allowed: below
          1280 the card itself scrolls horizontally (header + Actions column
          sticky throughout), and table-fixed + the colgroup below is what
          makes the widths in §B.2 real instead of a suggestion the browser's
          auto-layout algorithm is free to override. */}
      <div className="overflow-x-auto rounded-xl border border-gray-100">
        {/* Prompt 582 §B.4 — table-fixed alone has no floor: with only
            percentage/90px columns and no minimum, the table just keeps
            shrinking as the viewport narrows and the card's overflow-x-auto
            never actually triggers — the opposite of "below 1280 only the
            card scrolls". min-w on the table itself (not a single cell) is
            what makes that floor real, per this same lesson already applied
            per-cell on startups/investors (ModerationControls' min-w-48). */}
        <table className="w-full min-w-[1040px] table-fixed text-[13px]">
          {/* Prompt 582 §B.2 — one <col> per actual <td>, in the SAME order
              the thead/tbody below use (they interleave Geographies/Sectors,
              which aren't in CATALOG_COLUMNS, between its entries) — a
              colgroup shorter than the real column count doesn't error, it
              silently assigns widths to the wrong columns one slot over.
              Confirmed empirically: an earlier version of this file spread
              CATALOG_COLUMNS then appended 2 more <col>s at the end, which
              left Sectors — the column this prompt exists to fix — at 7%
              (aliasCount's width) instead of 22%. */}
          <colgroup>
            {CATALOG_COLUMNS.slice(0, 3).map((c) => <col key={c.key} style={{ width: `${c.widthPct}%` }} />)}
            <col style={{ width: '10%' }} />
            {CATALOG_COLUMNS.slice(3, 5).map((c) => <col key={c.key} style={{ width: `${c.widthPct}%` }} />)}
            <col style={{ width: '22%' }} />
            {CATALOG_COLUMNS.slice(5).map((c) => <col key={c.key} style={{ width: `${c.widthPct}%` }} />)}
            <col style={{ width: '90px' }} />
          </colgroup>
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
              {CATALOG_COLUMNS.slice(0, 3).map((c) => (
                <th key={c.key} className="cursor-pointer whitespace-nowrap py-2 pl-2 hover:text-gray-700" onClick={() => setSort(c.key)}>
                  {c.label} {tableState.sort === c.key ? (tableState.dir === 'asc' ? '▲' : '▼') : ''}
                </th>
              ))}
              <th className="py-2">Geographies</th>
              {CATALOG_COLUMNS.slice(3, 5).map((c) => (
                <th key={c.key} className="cursor-pointer whitespace-nowrap py-2 hover:text-gray-700" onClick={() => setSort(c.key)}>
                  {c.label} {tableState.sort === c.key ? (tableState.dir === 'asc' ? '▲' : '▼') : ''}
                </th>
              ))}
              <th className="py-2">Sectors</th>
              {CATALOG_COLUMNS.slice(5).map((c) => (
                <th key={c.key} className="cursor-pointer whitespace-nowrap py-2 hover:text-gray-700" onClick={() => setSort(c.key)}>
                  {c.label} {tableState.sort === c.key ? (tableState.dir === 'asc' ? '▲' : '▼') : ''}
                </th>
              ))}
              {/* Prompt 582 §B.2/§B.4 — sticky so Actions is never the thing
                  scrolled out of view; a real column, not an afterthought. */}
              <th className="sticky right-0 bg-white py-2 pr-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <Fragment key={c.id}>
                <tr className="border-t border-gray-50 align-top">
                  <td className="py-2 pl-2 font-medium">
                    <div className="truncate" title={c.name}>{c.name}</div>
                    {c.source === 'startup_submitted' && (
                      <span className="inline-block rounded-full bg-cyan-50 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-700">
                        Added by {extractProvenanceOrgName(c.notes) ?? 'a startup'}
                      </span>
                    )}
                    {c.website && <div className="truncate text-[11px] font-normal text-gray-400" title={c.website}>{c.website}</div>}
                  </td>
                  <td className="text-gray-500">{c.type.replace('_', ' ')}</td>
                  <td className="truncate text-gray-500" title={[c.hq_city, c.hq_country].filter(Boolean).join(', ')}>
                    {[c.hq_city, c.hq_country].filter(Boolean).join(', ') || '—'}
                  </td>
                  <td><ChipList items={c.geographies ?? []} /></td>
                  <td className="whitespace-nowrap text-gray-500">{fmtCheck(c.check_min_eur, c.check_max_eur)}</td>
                  <td className="text-gray-500">{fmtStage(c.stage_min, c.stage_max)}</td>
                  <td><ChipList items={c.sectors} /></td>
                  <td>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      c.verification_status === 'verified' ? 'bg-green-50 text-green-700' : c.verification_status === 'pending' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>
                      {c.verification_status}
                    </span>
                  </td>
                  <td>
                    {c.aliases.length > 0 ? (
                      <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600" title={c.aliases.join(', ')}>
                        {c.aliases.length}
                      </span>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="sticky right-0 bg-white pr-2">
                    <details className="relative">
                      <summary className="cursor-pointer list-none text-right text-xs text-gray-500 marker:content-none">⋯</summary>
                      <div className="absolute right-0 z-10 mt-1 w-40 space-y-1 rounded-lg border border-gray-200 bg-white p-2 text-left shadow-lg">
                        {c.verification_status !== 'verified' && <button onClick={() => setStatus(c.id, 'verified')} className="block w-full text-left text-xs text-green-700 hover:underline">Verify</button>}
                        {c.verification_status !== 'rejected' && <button onClick={() => setStatus(c.id, 'rejected')} className="block w-full text-left text-xs text-amber-700 hover:underline">Reject</button>}
                        <button onClick={() => setOpenContactsId(openContactsId === c.id ? null : c.id)} className="block w-full text-left text-xs text-cyan-700 hover:underline">
                          {openContactsId === c.id ? 'Close contacts' : `Contacts (${c.contacts.length})`}
                        </button>
                        <button onClick={() => setOpenActionsId(openActionsId === c.id ? null : c.id)} className="block w-full text-left text-xs text-cyan-700 hover:underline">
                          {openActionsId === c.id ? 'Close assist' : 'Assist'}
                        </button>
                        <button onClick={() => remove(c.id)} className="block w-full text-left text-xs text-[#B00000] hover:underline">Delete</button>
                      </div>
                    </details>
                  </td>
                </tr>
                {openContactsId === c.id && (
                  <tr className="border-t border-gray-50">
                    <td colSpan={10} className="py-2"><ContactsPanel entityId={c.id} contacts={c.contacts} refresh={refresh} /></td>
                  </tr>
                )}
                {openActionsId === c.id && (
                  <tr className="border-t border-gray-50">
                    <td colSpan={10} className="py-2"><OrgActionsPanel orgRefId={c.id} /></td>
                  </tr>
                )}
              </Fragment>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={10} className="py-4 text-center text-sm text-gray-400">No matches.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <button disabled={page <= 1} onClick={() => setTableState({ page: page - 1 })}
          className="rounded border border-gray-300 px-2 py-1 disabled:opacity-30">← Prev</button>
        <span>Page {page} of {totalPages}</span>
        <button disabled={page >= totalPages} onClick={() => setTableState({ page: page + 1 })}
          className="rounded border border-gray-300 px-2 py-1 disabled:opacity-30">Next →</button>
        <select value={tableState.pageSize} onChange={(e) => setTableState({ pageSize: Number(e.target.value) as typeof PAGE_SIZES[number] })}
          className="ml-1 rounded border border-gray-300 px-1.5 py-1">
          {PAGE_SIZES.map((s) => <option key={s} value={s}>{s} / page</option>)}
        </select>
      </div>
    </Card>
  );
}

// Prompt 569 §3 / 575 — the Suspense boundary useSearchParams() requires.
// Same established pattern as backoffice/queue/page.tsx: without it, `next
// build` compiles and then fails at the prerender step, and the deploy
// never lands. Verify by exit code, not by grepping build output.
export default function BackofficeCatalogPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-400">Loading catalog…</div>}>
      <BackofficeCatalogContent />
    </Suspense>
  );
}

type CatalogPageTab = 'catalog' | 'merge' | 'supply' | 'campaign';
const TAB_ORDER: CatalogPageTab[] = ['catalog', 'merge', 'supply', 'campaign'];

function BackofficeCatalogContent() {
  const [catalog, setCatalog] = useState<CatalogEntity[] | null>(null);
  const [err, setErr] = useState('');
  const [dedupeCount, setDedupeCount] = useState<number | null>(null);
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  // Prompt 582 §A — the page's own tab, same ?tab= mechanism the Queue
  // already uses. useTableUrlState (used inside CatalogTable) preserves
  // this exact param when it writes its own sort/page/filters, per
  // queue-table-state.ts's own RESERVED-tab handling — no coordination
  // needed between the two.
  const tab = (TAB_ORDER as string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as CatalogPageTab) : 'catalog';
  function setTab(next: CatalogPageTab) {
    const qs = new URLSearchParams(params.toString());
    if (next === 'catalog') qs.delete('tab'); else qs.set('tab', next);
    router.replace(qs.toString() ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function refresh() {
    fetch('/api/backoffice/catalog').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setCatalog(body.catalog);
    });
  }
  useEffect(refresh, []);
  useEffect(() => {
    // Prompt 582 §A — the tab label's own count, kept independent of
    // MergeDuplicatesTool's internal fetch (which needs the full cluster
    // detail, not just a number) rather than lifting its whole state up
    // for one label.
    fetch('/api/backoffice/catalog/dedupe').then((r) => r.json()).then((body) => {
      if (body.ok) setDedupeCount((body.clusters as unknown[]).length);
    }).catch(() => {});
  }, []);

  const TABS: { key: CatalogPageTab; label: string }[] = [
    { key: 'catalog', label: `Catalog${catalog ? ` (${catalog.length})` : ''}` },
    { key: 'merge', label: `Merge duplicates${dedupeCount !== null ? ` (${dedupeCount})` : ''}` },
    { key: 'supply', label: 'Outreach-ready supply' },
    // Prompt 581 §B.1 fills in a real count here once it lands; until then,
    // no number rather than an invented one.
    { key: 'campaign', label: 'Enrichment campaign' },
  ];

  return (
    <div className="space-y-5 overflow-x-hidden">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Catalog</h1>
        <a href="/api/backoffice/catalog/export" download
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
          ⬇ Export CSV
        </a>
      </div>
      {err && <p className="text-sm text-[#B00000]">{err}</p>}
      {/* Prompt 582 §A — four tabs instead of one long vertical stack;
          getting to the 763-row table no longer means scrolling past the
          1000-row enrichment list first. */}
      <div className="flex gap-1 border-b border-gray-100">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`rounded-t-lg px-3 py-2 text-sm font-medium ${tab === t.key ? 'border-b-2 border-[#0E7490] text-[#0E7490]' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'catalog' && catalog && <CatalogTable catalog={catalog} refresh={refresh} />}
      {tab === 'merge' && <MergeDuplicatesTool onMerged={() => { refresh(); }} />}
      {/* Prompt 544 Part E — above the campaign panel on purpose: it says
          WHO the next run should serve, which is the decision the panel below
          then executes. */}
      {tab === 'supply' && <OutreachSupplyCard />}
      {tab === 'campaign' && <EnrichmentCampaignPanel onEntityEnriched={refresh} />}
    </div>
  );
}
