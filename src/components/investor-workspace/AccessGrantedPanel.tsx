'use client';
// Investor Workspace — "Data room" (Prompt 121 §2.5, renamed and grown by
// Prompt 337/338 into the investor-side mirror of the founder's own Vault:
// everything startups have opened to this investor, grouped by startup,
// nothing they can share onward — strictly read-only, no share/grant button
// anywhere in this file). Three sub-tabs kept as-is (Granted/Requested/
// Expired); Prompt 338's own scope is enriching Granted specifically.
import { useEffect, useState } from 'react';

type SubTab = 'granted' | 'requested' | 'expired';

interface GrantedDoc { id: string; name: string; url: string | null; expiresAt: string | null; sharedAt: string; locked: boolean; isNew: boolean; folderName: string }
interface GrantedCard {
  orgId: string; orgName: string; logoUrl: string | null; level: 0 | 1 | 2 | 3 | null;
  grantedAt: string | null; pendingNdaCount: number; folders: { folderName: string; documents: GrantedDoc[] }[];
}
interface ExpiredCard { orgId: string; orgName: string; expiredAt: string | null; count: number }
interface RequestedCard { orgId: string; orgName: string; status: 'pending' | 'declined'; requestedAt: string; respondedAt: string | null }
interface AccessGrantedResponse { granted: GrantedCard[]; requested: RequestedCard[]; expired: ExpiredCard[] }

const LEVEL_LABEL: Record<0 | 1 | 2 | 3, string> = {
  0: 'Level 0 · Discovery', 1: 'Level 1 · Interested', 2: 'Level 2 · Full profile', 3: 'Level 3 · Contact granted',
};

function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : null;
}

function OrgAvatar({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  if (logoUrl) return <img src={logoUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />;
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold text-gray-600">
      {initials}
    </span>
  );
}

export function AccessGrantedPanel() {
  const [subTab, setSubTab] = useState<SubTab>('granted');
  const [data, setData] = useState<AccessGrantedResponse | null>(null);
  const [accessRequestsAvailable, setAccessRequestsAvailable] = useState(false);
  const [requestingOrgId, setRequestingOrgId] = useState<string | null>(null);
  const [justRequested, setJustRequested] = useState<Set<string>>(new Set());
  const [expandedOrgId, setExpandedOrgId] = useState<string | null>(null);
  // Prompt 338 — minimal filters: by startup, and "only new".
  const [startupFilter, setStartupFilter] = useState<string>('all');
  const [onlyNew, setOnlyNew] = useState(false);

  function load() {
    fetch('/api/portal/access-granted').then((r) => r.json()).then(setData).catch(() => setData(null));
    fetch('/api/me').then((r) => r.json()).then((d) => setAccessRequestsAvailable(!!d.capabilities?.accessRequests)).catch(() => {});
  }
  useEffect(load, []);

  async function requestAgain(orgId: string) {
    setRequestingOrgId(orgId);
    try {
      const res = await fetch('/api/portal/access-requests', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orgId }),
      });
      const body = await res.json();
      if (body.ok) setJustRequested((prev) => new Set(prev).add(orgId));
    } finally { setRequestingOrgId(null); }
  }

  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;

  const SUB_TABS: { value: SubTab; label: string; count?: number }[] = [
    { value: 'granted', label: 'Granted', count: data.granted.length },
    { value: 'requested', label: 'Requested', count: data.requested.filter((r) => r.status === 'pending').length },
    { value: 'expired', label: 'Expired', count: data.expired.length },
  ];

  // Prompt 338 — a card "has something new" if any of its documents does;
  // "only new" hides cards with nothing new rather than hiding individual
  // rows within a card (a startup you're mid-reviewing shouldn't visually
  // fragment just because one doc in it is old).
  const visibleGranted = data.granted
    .filter((c) => startupFilter === 'all' || c.orgId === startupFilter)
    .filter((c) => !onlyNew || c.folders.some((f) => f.documents.some((d) => d.isNew)));

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-lg font-bold text-gray-900">Data room</h1>
      <div data-tour-id="access-granted-tabs" className="flex items-center gap-1.5">
        {SUB_TABS.map((t) => (
          <button key={t.value} onClick={() => setSubTab(t.value)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${subTab === t.value ? 'bg-[#0E7490] text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {t.label}{t.count != null && t.count > 0 && ` (${t.count})`}
          </button>
        ))}
      </div>

      {subTab === 'granted' && (
        data.granted.length === 0 ? (
          <p data-tour-id="access-granted-list" className="text-sm text-gray-400">No startup has granted you access yet.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <select value={startupFilter} onChange={(e) => setStartupFilter(e.target.value)}
                className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] text-gray-600">
                <option value="all">All startups</option>
                {data.granted.map((c) => <option key={c.orgId} value={c.orgId}>{c.orgName}</option>)}
              </select>
              <label className="flex items-center gap-1.5 text-[11px] text-gray-600">
                <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} />
                Only new
              </label>
            </div>
            {visibleGranted.length === 0 ? (
              <p className="text-sm text-gray-400">Nothing matches these filters.</p>
            ) : (
              <div data-tour-id="access-granted-list" className="space-y-3">
                {visibleGranted.map((card) => {
                  const expanded = expandedOrgId === card.orgId;
                  const totalDocs = card.folders.reduce((n, f) => n + f.documents.length, 0);
                  return (
                    <div key={card.orgId} className="rounded-lg border border-gray-200 bg-white p-4">
                      <button onClick={() => setExpandedOrgId(expanded ? null : card.orgId)} className="flex w-full items-center justify-between text-left">
                        <div className="flex items-center gap-2.5">
                          <OrgAvatar name={card.orgName} logoUrl={card.logoUrl} />
                          <div>
                            <div className="text-sm font-semibold text-gray-900">{card.orgName}</div>
                            <div className="text-xs text-gray-400">
                              {totalDocs} document{totalDocs === 1 ? '' : 's'}
                              {card.grantedAt && ` · granted ${fmtDate(card.grantedAt)}`}
                              {card.level != null && ` · ${LEVEL_LABEL[card.level]}`}
                            </div>
                          </div>
                        </div>
                        <span className="text-xs text-gray-400">{expanded ? '▾' : '▸'}</span>
                      </button>
                      {expanded && (
                        <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
                          <a href={`/portal/startup/${card.orgId}?tab=documents`} className="text-xs font-medium text-[#0E7490] hover:underline">
                            Open in {card.orgName}&apos;s dossier →
                          </a>
                          {card.pendingNdaCount > 0 && (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                              Awaiting NDA — {card.pendingNdaCount} item{card.pendingNdaCount === 1 ? '' : 's'} below will unlock once your signed NDA is on file.
                            </div>
                          )}
                          {card.folders.map((f) => (
                            <div key={f.folderName}>
                              <div className="text-xs font-semibold text-gray-500">{f.folderName}</div>
                              <ul className="mt-1 space-y-1">
                                {f.documents.map((d) => (
                                  <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
                                    <span className={`flex items-center gap-1.5 ${d.locked ? 'text-gray-400' : 'text-gray-700'}`}>
                                      {d.locked && '🔒'} {d.name}
                                      {d.isNew && <span className="rounded-full bg-[#E8F4F8] px-1.5 py-0.5 text-[10px] font-semibold text-[#0E7490]">New</span>}
                                    </span>
                                    <div className="flex items-center gap-2">
                                      <span className="text-[11px] text-gray-400">shared {fmtDate(d.sharedAt)}</span>
                                      {d.expiresAt && <span className="text-[11px] text-gray-400">· until {fmtDate(d.expiresAt)}</span>}
                                      {d.locked ? (
                                        <span className="text-xs text-gray-300">Pending NDA</span>
                                      ) : d.url ? (
                                        <a href={d.url} target="_blank" rel="noreferrer" className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#0c637b]">
                                          Open
                                        </a>
                                      ) : (
                                        <span className="text-xs text-gray-300">Unavailable</span>
                                      )}
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )
      )}

      {subTab === 'requested' && (
        !accessRequestsAvailable ? (
          <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-6 text-center">
            <p className="text-sm text-gray-500">Coming soon — this tab will show access you&apos;ve requested but the founder hasn&apos;t granted yet.</p>
          </div>
        ) : data.requested.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-6 text-center">
            <p className="text-sm text-gray-500">No pending requests right now.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {data.requested.map((r) => (
              <div key={`${r.orgId}-${r.requestedAt}`} className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{r.orgName}</div>
                    <div className="text-xs text-gray-400">requested {fmtDate(r.requestedAt)}</div>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${r.status === 'pending' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                    {r.status === 'pending' ? 'Waiting on founder' : 'Declined'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {subTab === 'expired' && (
        data.expired.length === 0 ? (
          <p className="text-sm text-gray-400">Nothing has expired.</p>
        ) : (
          <div className="space-y-3">
            {data.expired.map((card) => (
              <div key={card.orgId} className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{card.orgName}</div>
                    <div className="text-xs text-gray-400">
                      {card.count} item{card.count === 1 ? '' : 's'}{card.expiredAt && ` · expired ${fmtDate(card.expiredAt)}`}
                    </div>
                  </div>
                  {accessRequestsAvailable ? (
                    justRequested.has(card.orgId) ? (
                      <span className="text-xs font-medium text-amber-700">Requested</span>
                    ) : (
                      <button onClick={() => requestAgain(card.orgId)} disabled={requestingOrgId === card.orgId}
                        className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-[#0E7490] disabled:opacity-40">
                        {requestingOrgId === card.orgId ? 'Requesting…' : 'Request again'}
                      </button>
                    )
                  ) : (
                    <span title="Coming soon" className="text-xs text-gray-300">Request again</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
