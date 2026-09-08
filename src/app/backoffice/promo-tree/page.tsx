'use client';
// Prompt 854 §D.2 — the read-only genealogy of every org that came in
// through a promo code (campaign or referral). Client-side filters over the
// fetched-once node list, same reasoning as the outreach table (§B.3): this
// is tens/hundreds of orgs, not thousands. Clicking a row opens that org's
// ancestors up to the root plus its whole subtree, as a simple indented
// tree — no canvas or graph library, a new dependency for a back-office
// list is not warranted.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

interface PromoNode {
  orgId: string; orgName: string; code: string; parentOrgId: string | null;
  redeemedAt: string; wave: number; directChildren: number; totalDescendants: number;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function GenealogyBranch({ node, byId, childrenOf, highlight }: {
  node: PromoNode; byId: Map<string, PromoNode>; childrenOf: Map<string, PromoNode[]>; highlight: string;
}) {
  const kids = childrenOf.get(node.orgId) ?? [];
  return (
    <li className="border-l border-gray-200 pl-3">
      <div className={`flex flex-wrap items-center gap-2 rounded-lg px-2 py-1 text-sm ${node.orgId === highlight ? 'bg-[#E8F4F8] font-semibold text-gray-900' : 'text-gray-700'}`}>
        <span>{node.orgName}</span>
        <span className="font-mono text-[11px] text-gray-400">{node.code}</span>
        <span className="text-[11px] text-gray-400">wave {node.wave}</span>
        <span className="text-[11px] text-gray-400">{fmtDate(node.redeemedAt)}</span>
      </div>
      {kids.length > 0 && (
        <ul className="ml-1.5 mt-0.5 space-y-0.5">
          {kids.map((k) => <GenealogyBranch key={k.orgId} node={k} byId={byId} childrenOf={childrenOf} highlight={highlight} />)}
        </ul>
      )}
    </li>
  );
}

export default function PromoTreePage() {
  const [nodes, setNodes] = useState<PromoNode[] | null>(null);
  const [ignoredEdges, setIgnoredEdges] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const [nameFilter, setNameFilter] = useState('');
  const [waveFilter, setWaveFilter] = useState('');
  const [waveMode, setWaveMode] = useState<'exact' | 'atLeast'>('exact');
  const [belowFilter, setBelowFilter] = useState('');

  useEffect(() => {
    fetch('/api/backoffice/promo-tree').then((r) => r.json()).then((body) => {
      if (!body.ok) { setErr(body.error ?? 'Could not load the promo tree.'); return; }
      setNodes(body.nodes);
      setIgnoredEdges(body.ignoredEdges ?? []);
    }).catch(() => setErr('Could not load the promo tree.'));
  }, []);

  const byId = useMemo(() => new Map((nodes ?? []).map((n) => [n.orgId, n])), [nodes]);
  const childrenOf = useMemo(() => {
    const m = new Map<string, PromoNode[]>();
    for (const n of nodes ?? []) {
      if (!n.parentOrgId) continue;
      const list = m.get(n.parentOrgId) ?? [];
      list.push(n);
      m.set(n.parentOrgId, list);
    }
    return m;
  }, [nodes]);

  const filtered = useMemo(() => {
    if (!nodes) return [];
    const wave = waveFilter.trim() === '' ? null : Number(waveFilter);
    const below = belowFilter.trim() === '' ? null : Number(belowFilter);
    return nodes.filter((n) =>
      (!nameFilter.trim() || n.orgName.toLowerCase().includes(nameFilter.trim().toLowerCase()))
      && (wave === null || (waveMode === 'exact' ? n.wave === wave : n.wave >= wave))
      && (below === null || n.totalDescendants >= below));
  }, [nodes, nameFilter, waveFilter, waveMode, belowFilter]);

  const anyFilterSet = !!(nameFilter.trim() || waveFilter.trim() || belowFilter.trim());

  const selectedNode = selected ? byId.get(selected) ?? null : null;
  // Ancestors up to the root, closest-first.
  const ancestors: PromoNode[] = [];
  if (selectedNode) {
    let cur = selectedNode.parentOrgId ? byId.get(selectedNode.parentOrgId) : undefined;
    while (cur) {
      ancestors.push(cur);
      cur = cur.parentOrgId ? byId.get(cur.parentOrgId) : undefined;
    }
  }
  const root = selectedNode ? (ancestors[ancestors.length - 1] ?? selectedNode) : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Promo tree</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Every org that came in through a promo code — campaign or referral — and the pyramid it grew underneath it.
          Read-only: nothing here revokes, re-issues, or edits a code (that stays on Promo codes &amp; offers).
        </p>
      </div>

      {err && <p className="text-sm text-[#B00000]">{err}</p>}
      {ignoredEdges.length > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {ignoredEdges.length} code{ignoredEdges.length === 1 ? '' : 's'} formed a referral loop and{' '}
          {ignoredEdges.length === 1 ? 'was' : 'were'} treated as a root instead: {ignoredEdges.join(', ')}.
        </p>
      )}

      {!nodes ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : nodes.length === 0 ? (
        <p className="text-sm text-gray-400">No org has joined through a promo code yet.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr,360px]">
          <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-0.5 text-[11px] text-gray-500">
                Name
                <input value={nameFilter} onChange={(e) => setNameFilter(e.target.value)} autoComplete="off"
                  className="w-44 rounded border border-gray-300 px-2 py-1 text-xs" />
              </label>
              <label className="flex flex-col gap-0.5 text-[11px] text-gray-500">
                Wave
                <div className="flex gap-1">
                  <select value={waveMode} onChange={(e) => setWaveMode(e.target.value as 'exact' | 'atLeast')}
                    className="rounded border border-gray-300 px-1 py-1 text-xs">
                    <option value="exact">=</option>
                    <option value="atLeast">≥</option>
                  </select>
                  <input type="number" min={0} value={waveFilter} autoComplete="off" onChange={(e) => setWaveFilter(e.target.value)}
                    className="w-16 rounded border border-gray-300 px-2 py-1 text-xs" />
                </div>
              </label>
              <label className="flex flex-col gap-0.5 text-[11px] text-gray-500">
                Orgs joined below (min)
                <input type="number" min={0} value={belowFilter} autoComplete="off" onChange={(e) => setBelowFilter(e.target.value)}
                  className="w-24 rounded border border-gray-300 px-2 py-1 text-xs" />
              </label>
              {anyFilterSet && (
                <button onClick={() => { setNameFilter(''); setWaveFilter(''); setBelowFilter(''); }}
                  className="text-xs text-gray-400 hover:underline">Clear filters</button>
              )}
              <span className="ml-auto text-xs text-gray-400">showing {filtered.length} of {nodes.length}</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-[11px] font-bold uppercase tracking-wide text-gray-400">
                    <th className="pb-2">Org</th>
                    <th className="pb-2">Code used</th>
                    <th className="pb-2">Wave</th>
                    <th className="pb-2">Joined</th>
                    <th className="pb-2">Direct</th>
                    <th className="pb-2">Total below</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={7} className="py-4 text-center text-xs text-gray-400">No rows match these filters.</td></tr>
                  ) : filtered.map((n) => (
                    <tr key={n.orgId} onClick={() => setSelected(n.orgId)}
                      className={`cursor-pointer border-b border-gray-50 align-top hover:bg-gray-50 ${selected === n.orgId ? 'bg-[#E8F4F8]' : ''}`}>
                      <td className="py-2 font-semibold text-gray-900">{n.orgName}</td>
                      <td className="py-2 font-mono text-xs text-gray-500">{n.code}</td>
                      <td className="py-2 text-gray-600">{n.wave}</td>
                      <td className="py-2 text-xs text-gray-500">{fmtDate(n.redeemedAt)}</td>
                      <td className="py-2 text-gray-600">{n.directChildren}</td>
                      <td className="py-2 text-gray-600">{n.totalDescendants}</td>
                      <td className="py-2 text-xs text-[#0E7490]">View →</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-bold text-gray-900">Genealogy</h2>
            {!selectedNode ? (
              <p className="mt-2 text-xs text-gray-400">Click a row to see its ancestors and everyone below it.</p>
            ) : (
              <div className="mt-2 space-y-3">
                <Link href="/backoffice/startups" className="text-xs text-[#0E7490] hover:underline">
                  {selectedNode.orgName} → open in Startups
                </Link>
                {ancestors.length > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Ancestors (root first)</div>
                    <ul className="mt-1 space-y-0.5">
                      {[...ancestors].reverse().map((a) => (
                        <li key={a.orgId} className="text-xs text-gray-600">
                          {a.orgName} <span className="text-gray-400">· wave {a.wave} · {fmtDate(a.redeemedAt)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                    {root && root.orgId !== selectedNode.orgId ? `Full tree from the root (${root.orgName})` : 'This org and everyone below it'}
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    <GenealogyBranch node={root ?? selectedNode} byId={byId} childrenOf={childrenOf} highlight={selectedNode.orgId} />
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
