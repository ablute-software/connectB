'use client';
// BLOCO 3 — Catálogo: catalog_entities CRUD, the merge-duplicates tool
// (§9b-3, "ferramenta prioritária"), packs, the quality panel (completeness
// + enrichment queue + Research AI — moved here from the old single-page
// back-office), and the cross-org distribution log.
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';

type CatalogEntity = {
  id: string; name: string; type: string; hq_city: string | null; hq_country: string | null;
  sectors: string[]; website: string | null; verification_status: 'verified' | 'pending' | 'rejected';
  verified_at: string | null; source: string; notes: string | null; aliases: string[];
};

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

function CatalogTable({ catalog, refresh }: { catalog: CatalogEntity[]; refresh: () => void }) {
  const [newRow, setNewRow] = useState({ name: '', type: 'vc', website: '' });
  const [creating, setCreating] = useState(false);

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
    <Card title={`Catalog (${catalog.length})`}>
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
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
            <th className="py-1.5">Investor</th><th>Type</th><th>HQ</th><th>Status</th><th>Aliases</th><th></th>
          </tr>
        </thead>
        <tbody>
          {catalog.map((c) => (
            <tr key={c.id} className="border-t border-gray-50 align-top">
              <td className="py-2 font-medium">{c.name}{c.website && <div className="text-xs font-normal text-gray-400">{c.website}</div>}</td>
              <td className="text-gray-500">{c.type.replace('_', ' ')}</td>
              <td className="text-gray-500">{[c.hq_city, c.hq_country].filter(Boolean).join(', ')}</td>
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
                <button onClick={() => remove(c.id)} className="text-xs text-[#B00000] hover:underline">Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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

function QualityPanel() {
  const [queue, setQueue] = useState<EnrichmentRow[] | null>(null);
  const [err, setErr] = useState('');
  const [research, setResearch] = useState<Record<string, ResearchResult>>({});

  useEffect(() => {
    fetch('/api/backoffice/enrichment').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setQueue(body.queue);
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
  if (!queue) return <Card title="Quality — enrichment queue"><p className="text-sm text-gray-400">Loading…</p></Card>;

  return (
    <Card title={`Quality — profiles below 70% (${queue.length})`}>
      <p className="mb-3 text-xs text-gray-500">Ranked by demand. "Research with AI" proposes fields with source + confidence, queued for verification in Fila → Contributions.</p>
      {queue.length === 0 ? <p className="text-sm text-gray-400">Nothing below the completeness threshold right now.</p> : (
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
                    <button onClick={() => researchRow(r.subjectType, r.name)} disabled={rr?.status === 'loading'}
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

type Pack = { id: string; name: string; description: string | null; price_eur: number; active: boolean; catalogIds: string[] };

function PacksPanel({ catalog }: { catalog: CatalogEntity[] }) {
  const [packs, setPacks] = useState<Pack[] | null>(null);
  const [newName, setNewName] = useState('');

  function refresh() {
    fetch('/api/backoffice/packs').then((r) => r.json()).then((body) => { if (body.ok) setPacks(body.packs); });
  }
  useEffect(refresh, []);

  async function create() {
    if (!newName) return;
    await fetch('/api/backoffice/packs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newName }) });
    setNewName(''); refresh();
  }
  async function toggleItem(packId: string, catalogId: string, has: boolean) {
    await fetch(`/api/backoffice/packs/${packId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(has ? { removeCatalogId: catalogId } : { addCatalogId: catalogId }),
    });
    refresh();
  }

  if (!packs) return <Card title="Packs"><p className="text-sm text-gray-400">Loading…</p></Card>;

  return (
    <Card title={`Packs (${packs.length})`}>
      <div className="mb-3 flex gap-2">
        <input placeholder="New pack name" value={newName} onChange={(e) => setNewName(e.target.value)} className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
        <button disabled={!newName} onClick={create} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Create pack</button>
      </div>
      <div className="space-y-3">
        {packs.map((p) => (
          <details key={p.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <summary className="cursor-pointer text-sm font-semibold">{p.name} <span className="font-normal text-gray-400">— {p.catalogIds.length} investor(s){p.active ? '' : ' · inactive'}</span></summary>
            <div className="mt-2 max-h-48 space-y-1 overflow-y-auto text-sm">
              {catalog.filter((c) => c.verification_status === 'verified').map((c) => {
                const has = p.catalogIds.includes(c.id);
                return (
                  <label key={c.id} className="flex items-center gap-2">
                    <input type="checkbox" checked={has} onChange={() => toggleItem(p.id, c.id, has)} /> {c.name}
                  </label>
                );
              })}
            </div>
          </details>
        ))}
      </div>
    </Card>
  );
}

function DistributionLog() {
  const [deliveries, setDeliveries] = useState<{ id: string; orgName: string; catalogName: string; packName: string | null; delivered_at: string }[] | null>(null);
  useEffect(() => {
    fetch('/api/backoffice/distribution').then((r) => r.json()).then((body) => { if (body.ok) setDeliveries(body.deliveries); });
  }, []);
  if (!deliveries) return <Card title="Distribution log"><p className="text-sm text-gray-400">Loading…</p></Card>;
  return (
    <Card title="Distribution log — who received what (cross-org)">
      {deliveries.length === 0 ? <p className="text-sm text-gray-400">No deliveries yet.</p> : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400"><th className="py-1.5">Date</th><th>Org</th><th>Investor</th><th>Pack</th></tr></thead>
          <tbody>
            {deliveries.map((d) => (
              <tr key={d.id} className="border-t border-gray-50">
                <td className="py-2 text-xs text-gray-400">{d.delivered_at.slice(0, 10)}</td>
                <td className="text-xs font-medium">{d.orgName}</td>
                <td className="text-xs">{d.catalogName}</td>
                <td className="text-xs text-gray-500">{d.packName ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-2 text-[11px] text-gray-400">An investor is never delivered twice to the same org (unique org+catalog constraint).</p>
    </Card>
  );
}

export default function BackofficeCatalogPage() {
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
      <h1 className="text-lg font-bold">Catálogo</h1>
      <MergeDuplicatesTool onMerged={refresh} />
      {err && <p className="text-sm text-[#B00000]">{err}</p>}
      {catalog && <CatalogTable catalog={catalog} refresh={refresh} />}
      {catalog && <PacksPanel catalog={catalog} />}
      <QualityPanel />
      <DistributionLog />
    </div>
  );
}
