'use client';
// BLOCO 3 — Catálogo: catalog_entities CRUD, the merge-duplicates tool
// (§9b-3, "ferramenta prioritária"), packs, the quality panel (completeness
// + enrichment queue + Research AI — moved here from the old single-page
// back-office), and the cross-org distribution log.
//
// Prompt 187 — two tabs now: "Catalog" (search + filters + per-row
// contacts) and "Added by startups" (every org's manually-added `entities`
// rows, cross-referenced against the catalog for duplicates, with
// merge/promote actions; Quality folded in here too since both read the
// same entities/people tables — see §D, "Recomendo a segunda opção").
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Card, Tabs } from '@/components/ui';

type ContactRow = {
  id: string; fullName: string; linkedinUrl: string | null; hookStatus: string;
  doNotContact: boolean; title: string | null; isPrimary: boolean;
};

type CatalogEntity = {
  id: string; name: string; type: string; hq_city: string | null; hq_country: string | null;
  sectors: string[]; website: string | null; verification_status: 'verified' | 'pending' | 'rejected';
  verified_at: string | null; source: string; notes: string | null; aliases: string[];
  stage_min: string | null; stage_max: string | null; check_min_eur: number | null; check_max_eur: number | null;
  geographies: string[] | null; contacts: ContactRow[];
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

function MergeDuplicatesTool({ onMerged }: { onMerged: () => void }) {
  const [clusters, setClusters] = useState<{ reasons: string[]; members: CatalogEntity[] }[] | null>(null);
  const [err, setErr] = useState('');
  const [keepChoice, setKeepChoice] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [result, setResult] = useState('');

  function refresh() {
    fetch('/api/backoffice/catalog/dedupe').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setClusters(body.clusters);
    });
  }
  useEffect(refresh, []);

  async function merge(i: number, cluster: { members: CatalogEntity[] }) {
    const keepId = keepChoice[i] ?? cluster.members[0].id;
    const mergeIds = cluster.members.map((m) => m.id).filter((id) => id !== keepId);
    setBusy(i); setResult('');
    const res = await fetch('/api/backoffice/catalog/merge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keepId, mergeIds }),
    });
    const body = await res.json();
    setBusy(null);
    if (body.ok === false) { setResult(body.error); return; }
    setResult(`Merged ${body.mergedCount} row(s) into the kept entry.${Object.keys(body.conflicts ?? {}).length ? ' Some fields conflicted and were left for manual review — see the audit log.' : ''}`);
    refresh(); onMerged();
  }

  if (err) return <Card title="Merge duplicates"><p className="text-sm text-[#B00000]">{err}</p></Card>;
  if (!clusters) return <Card title="Merge duplicates"><p className="text-sm text-gray-400">Scanning…</p></Card>;

  return (
    <Card title={`Merge duplicates (${clusters.length})`} tint={clusters.length > 0 ? 'amber' : undefined}>
      <p className="mb-3 text-xs text-gray-500">
        Matched by normalized website domain, normalized name (diacritics/legal-suffix/parenthetical stripped), and known aliases.
      </p>
      {result && <p className="mb-2 text-xs text-cyan-800">{result}</p>}
      {clusters.length === 0 ? <p className="text-sm text-gray-400">No likely duplicates found.</p> : (
        <div className="space-y-3">
          {clusters.map((cl, i) => (
            <div key={i} className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
              <div className="mb-2 flex items-center gap-2 text-xs text-amber-800">
                Matched by: {cl.reasons.join(', ')}
              </div>
              <ul className="space-y-1 text-sm">
                {cl.members.map((m) => (
                  <li key={m.id} className="flex items-center gap-2">
                    <input type="radio" name={`keep-${i}`} checked={(keepChoice[i] ?? cl.members[0].id) === m.id}
                      onChange={() => setKeepChoice({ ...keepChoice, [i]: m.id })} />
                    <span className="font-medium">{m.name}</span>
                    {m.website && <span className="text-xs text-gray-400">{m.website}</span>}
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${m.verification_status === 'verified' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{m.verification_status}</span>
                  </li>
                ))}
              </ul>
              <button disabled={busy === i} onClick={() => merge(i, cl)}
                className="mt-2 rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-40">
                {busy === i ? 'Merging…' : 'Merge into selected'}
              </button>
            </div>
          ))}
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

function CatalogTable({ catalog, refresh }: { catalog: CatalogEntity[]; refresh: () => void }) {
  const [newRow, setNewRow] = useState({ name: '', type: 'vc', website: '' });
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [openActionsId, setOpenActionsId] = useState<string | null>(null);
  const [openContactsId, setOpenContactsId] = useState<string | null>(null);

  // Prompt 187 §B — filters, client-side only: the data's already in the
  // GET /api/backoffice/catalog response, no new endpoint needed. Options
  // are derived from the current catalog rather than hardcoded so they
  // never drift from what's actually in the table.
  const [typeFilter, setTypeFilter] = useState('');
  const [countryFilter, setCountryFilter] = useState('');
  const [geoFilter, setGeoFilter] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [sectorFilter, setSectorFilter] = useState('');
  const [checkMin, setCheckMin] = useState('');
  const [checkMax, setCheckMax] = useState('');

  const typeOptions = useMemo(() => Array.from(new Set(catalog.map((c) => c.type))).sort(), [catalog]);
  const countryOptions = useMemo(() => Array.from(new Set(catalog.map((c) => c.hq_country).filter((v): v is string => !!v))).sort(), [catalog]);
  const geoOptions = useMemo(() => Array.from(new Set(catalog.flatMap((c) => c.geographies ?? []))).sort(), [catalog]);
  const stageOptions = useMemo(() => Array.from(new Set(catalog.flatMap((c) => [c.stage_min, c.stage_max]).filter((v): v is string => !!v))).sort(), [catalog]);
  const sectorOptions = useMemo(() => Array.from(new Set(catalog.flatMap((c) => c.sectors))).sort(), [catalog]);

  const hasFilters = !!(typeFilter || countryFilter || geoFilter || stageFilter || sectorFilter || checkMin || checkMax);
  function clearFilters() {
    setTypeFilter(''); setCountryFilter(''); setGeoFilter(''); setStageFilter(''); setSectorFilter(''); setCheckMin(''); setCheckMax('');
  }

  function checkMatches(c: CatalogEntity): boolean {
    if (!checkMin && !checkMax) return true;
    if (c.check_min_eur == null && c.check_max_eur == null) return false;
    const lo = c.check_min_eur ?? c.check_max_eur!;
    const hi = c.check_max_eur ?? c.check_min_eur!;
    const filterLo = checkMin ? Number(checkMin) : -Infinity;
    const filterHi = checkMax ? Number(checkMax) : Infinity;
    return hi >= filterLo && lo <= filterHi;
  }

  const q = search.trim().toLowerCase();
  const filtered = catalog.filter((c) => {
    if (q && !c.name.toLowerCase().includes(q)) return false;
    if (typeFilter && c.type !== typeFilter) return false;
    if (countryFilter && c.hq_country !== countryFilter) return false;
    if (geoFilter && !(c.geographies ?? []).includes(geoFilter)) return false;
    if (stageFilter && c.stage_min !== stageFilter && c.stage_max !== stageFilter) return false;
    if (sectorFilter && !c.sectors.includes(sectorFilter)) return false;
    if (!checkMatches(c)) return false;
    return true;
  });

  async function create() {
    if (!newRow.name) return;
    setCreating(true);
    await fetch('/api/backoffice/catalog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newRow) });
    setCreating(false); setNewRow({ name: '', type: 'vc', website: '' }); refresh();
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
    <Card title={`Catalog (${filtered.length}${filtered.length !== catalog.length ? ` of ${catalog.length}` : ''})`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input placeholder="New investor name" value={newRow.name} onChange={(e) => setNewRow({ ...newRow, name: e.target.value })}
          className="min-w-[200px] flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
        <select value={newRow.type} onChange={(e) => setNewRow({ ...newRow, type: e.target.value })} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
          {['vc', 'corporate_vc', 'family_office', 'angel_fund', 'angel_network', 'public_body', 'accelerator'].map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
        </select>
        <input placeholder="Website" value={newRow.website} onChange={(e) => setNewRow({ ...newRow, website: e.target.value })}
          className="min-w-[160px] rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
        <button disabled={!newRow.name || creating} onClick={create} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Add</button>
      </div>
      <input placeholder="Search by name…" value={search} onChange={(e) => setSearch(e.target.value)}
        className="mb-3 w-full max-w-sm rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1 text-xs">
          <option value="">All types</option>
          {typeOptions.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
        </select>
        <select value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1 text-xs">
          <option value="">All HQ countries</option>
          {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={geoFilter} onChange={(e) => setGeoFilter(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1 text-xs">
          <option value="">All geographies</option>
          {geoOptions.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1 text-xs">
          <option value="">All stages</option>
          {stageOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={sectorFilter} onChange={(e) => setSectorFilter(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1 text-xs">
          <option value="">All sectors</option>
          {sectorOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input type="number" placeholder="Check min €" value={checkMin} onChange={(e) => setCheckMin(e.target.value)} className="w-28 rounded-lg border border-gray-300 px-2 py-1 text-xs" />
        <input type="number" placeholder="Check max €" value={checkMax} onChange={(e) => setCheckMax(e.target.value)} className="w-28 rounded-lg border border-gray-300 px-2 py-1 text-xs" />
        {hasFilters && <button onClick={clearFilters} className="text-xs text-gray-400 hover:underline">Clear filters</button>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
              <th className="py-1.5">Investor</th><th>Type</th><th>HQ</th><th>Geographies</th><th>Check</th><th>Stage</th><th>Sectors</th><th>Status</th><th>Aliases</th><th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <Fragment key={c.id}>
                <tr className="border-t border-gray-50 align-top">
                  <td className="py-2 font-medium">{c.name}{c.website && <div className="text-xs font-normal text-gray-400">{c.website}</div>}</td>
                  <td className="text-gray-500">{c.type.replace('_', ' ')}</td>
                  <td className="text-gray-500">{[c.hq_city, c.hq_country].filter(Boolean).join(', ') || '—'}</td>
                  <td className="max-w-[160px] text-xs text-gray-500">{c.geographies?.length ? c.geographies.join(', ') : '—'}</td>
                  <td className="whitespace-nowrap text-gray-500">{fmtCheck(c.check_min_eur, c.check_max_eur)}</td>
                  <td className="text-gray-500">{fmtStage(c.stage_min, c.stage_max)}</td>
                  <td className="max-w-[220px] text-xs text-gray-500">{c.sectors.length ? c.sectors.join(', ') : '—'}</td>
                  <td>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      c.verification_status === 'verified' ? 'bg-green-50 text-green-700' : c.verification_status === 'pending' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>
                      {c.verification_status}
                    </span>
                  </td>
                  <td className="text-xs text-gray-400">{c.aliases.join(', ') || '—'}</td>
                  <td className="whitespace-nowrap text-right">
                    {c.verification_status !== 'verified' && <button onClick={() => setStatus(c.id, 'verified')} className="mr-1 text-xs text-green-700 hover:underline">Verify</button>}
                    {c.verification_status !== 'rejected' && <button onClick={() => setStatus(c.id, 'rejected')} className="mr-1 text-xs text-amber-700 hover:underline">Reject</button>}
                    <button onClick={() => setOpenContactsId(openContactsId === c.id ? null : c.id)} className="mr-1 text-xs text-cyan-700 hover:underline">
                      {openContactsId === c.id ? 'Close' : `Contacts (${c.contacts.length})`}
                    </button>
                    <button onClick={() => setOpenActionsId(openActionsId === c.id ? null : c.id)} className="mr-1 text-xs text-cyan-700 hover:underline">
                      {openActionsId === c.id ? 'Close' : 'Assist'}
                    </button>
                    <button onClick={() => remove(c.id)} className="text-xs text-[#B00000] hover:underline">Delete</button>
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
            {filtered.length === 0 && (
              <tr><td colSpan={10} className="py-4 text-center text-sm text-gray-400">No matches.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
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

type ManualEntity = {
  id: string; orgId: string; orgName: string; name: string; website: string | null;
  hqCity: string | null; hqCountry: string | null; geographies: string[] | null;
  stageMin: string | null; stageMax: string | null; checkMinEur: number | null; checkMaxEur: number | null;
  sectors: string[]; thesis: string | null; email: string | null; phone: string | null; createdAt: string;
  likelyDuplicate: { catalogId: string; reason: 'domain' | 'name' | 'alias'; catalogEntity: { id: string; name: string; website: string | null; verificationStatus: string } } | null;
};

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

// Prompt 187 §A — every `entities` row with source='manual', across every
// org, cross-checked against the catalog with the same criteria
// MergeDuplicatesTool already uses (see /lib/manual-entity-match.ts).
// Flagged rows offer "merge into catalog" (fills the catalog row's empty
// fields, never touches the source row); unflagged rows offer "promote",
// which is deliberately the ONLY distribution mechanism built here — a
// promoted row becomes a normal catalog_entities row, so catalog_top_matches
// picks it up for every org once verified. The prompt's own text raises and
// then answers this ("o caminho correto e mais simples... evitar inventar
// um segundo caminho de distribuição direta org-a-org"); no second
// "add to other startups' pipelines" UI was built on that basis.
function AddedByStartupsTab({ catalog, onPromoted }: { catalog: CatalogEntity[]; onPromoted: () => void }) {
  const [rows, setRows] = useState<ManualEntity[] | null>(null);
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, string>>({});
  const [compareId, setCompareId] = useState<string | null>(null);

  function refresh() {
    fetch('/api/backoffice/catalog/manual-entities').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setRows(body.manualEntities);
    });
  }
  useEffect(refresh, []);

  async function mergeInto(row: ManualEntity) {
    if (!row.likelyDuplicate) return;
    setBusyId(row.id);
    const res = await fetch('/api/backoffice/catalog/merge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keepId: row.likelyDuplicate.catalogId, manualEntityId: row.id }),
    });
    const body = await res.json();
    setBusyId(null);
    setResult((prev) => ({ ...prev, [row.id]: body.ok === false ? body.error : 'Merged missing fields into the catalog entry.' }));
    if (body.ok !== false) { refresh(); onPromoted(); }
  }

  async function promote(row: ManualEntity) {
    setBusyId(row.id);
    const res = await fetch('/api/backoffice/catalog/promote', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manualEntityId: row.id }),
    });
    const body = await res.json();
    setBusyId(null);
    setResult((prev) => ({ ...prev, [row.id]: body.ok === false ? body.error : 'Added to the catalog (pending verification) — visible to every org via top matches once verified.' }));
    if (body.ok !== false) { refresh(); onPromoted(); }
  }

  if (err) return <Card title="Added by startups"><p className="text-sm text-[#B00000]">{err}</p></Card>;
  if (!rows) return <Card title="Added by startups"><p className="text-sm text-gray-400">Loading…</p></Card>;

  return (
    <Card title={`Added by startups (${rows.length})`}>
      <p className="mb-3 text-xs text-gray-500">
        Every investor a founder added manually (any org), cross-checked against the shared catalog by domain, name,
        and known aliases. Flagged rows already look like an existing catalog entry — merging fills gaps on the
        catalog row without ever overwriting correct data or touching the founder&apos;s own record. Otherwise,
        promote it straight into the catalog — that&apos;s also how it becomes visible to other startups&apos; matches.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
              <th className="py-1.5">Startup org</th><th>Investor</th><th>HQ</th><th>Geographies</th><th>Stage</th><th>Sectors</th><th>Contact</th><th>Match</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const catalogEntity = r.likelyDuplicate ? catalog.find((c) => c.id === r.likelyDuplicate!.catalogId) : undefined;
              return (
                <Fragment key={r.id}>
                  <tr className="border-t border-gray-50 align-top">
                    <td className="py-2 text-gray-500">{r.orgName}</td>
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
                      {r.likelyDuplicate ? (
                        <button disabled={busyId === r.id} onClick={() => mergeInto(r)} className="text-xs text-cyan-700 hover:underline disabled:opacity-40">Merge into catalog</button>
                      ) : (
                        <button disabled={busyId === r.id} onClick={() => promote(r)} className="text-xs text-[#0E7490] hover:underline disabled:opacity-40">Promote to catalog</button>
                      )}
                    </td>
                  </tr>
                  {compareId === r.id && catalogEntity && (
                    <tr className="border-t border-gray-50"><td colSpan={9} className="py-2"><CompareTable manual={r} catalogEntity={catalogEntity} /></td></tr>
                  )}
                  {result[r.id] && (
                    <tr><td colSpan={9} className="pb-2 text-xs text-gray-500">{result[r.id]}</td></tr>
                  )}
                </Fragment>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={9} className="py-4 text-center text-sm text-gray-400">No manually-added investors from startups yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function BackofficeCatalogPage() {
  const [tab, setTab] = useState<'catalog' | 'startups'>('catalog');
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
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Catalog</h1>
        <a href="/api/backoffice/catalog/export" download
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
          ⬇ Export CSV
        </a>
      </div>
      <Tabs
        items={[{ key: 'catalog', label: 'Catalog' }, { key: 'startups', label: 'Added by startups' }]}
        active={tab} onChange={(k) => setTab(k as 'catalog' | 'startups')}
      />
      {err && <p className="text-sm text-[#B00000]">{err}</p>}
      {tab === 'catalog' && (
        <>
          <MergeDuplicatesTool onMerged={refresh} />
          {catalog && <CatalogTable catalog={catalog} refresh={refresh} />}
        </>
      )}
      {tab === 'startups' && (
        <div className="space-y-4">
          {catalog && <AddedByStartupsTab catalog={catalog} onPromoted={refresh} />}
          <QualityPanel />
        </div>
      )}
    </div>
  );
}
