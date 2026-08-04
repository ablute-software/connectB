'use client';
// Investor Workspace — "Access granted" (Prompt 121 §2.5). Three tabs:
// Granted (real data today — the org's own access_grants), Requested (real
// once migration 0114 lands; a "coming soon" placeholder until then, gated
// on /api/me's accessRequests capability), Expired (real today; "Request
// again" is itself gated on the same capability, since it writes to the
// not-yet-existing access_requests table).
import { useEffect, useState } from 'react';

type SubTab = 'granted' | 'requested' | 'expired';

interface GrantedCard {
  orgId: string; orgName: string; grantedAt: string | null;
  folders: { folderName: string; documents: { id: string; name: string; url: string | null; expiresAt: string | null }[] }[];
}
interface ExpiredCard { orgId: string; orgName: string; expiredAt: string | null; count: number }
interface AccessGrantedResponse { granted: GrantedCard[]; requested: unknown[]; expired: ExpiredCard[] }

function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : null;
}

export function AccessGrantedPanel() {
  const [subTab, setSubTab] = useState<SubTab>('granted');
  const [data, setData] = useState<AccessGrantedResponse | null>(null);
  const [accessRequestsAvailable, setAccessRequestsAvailable] = useState(false);
  const [requestingOrgId, setRequestingOrgId] = useState<string | null>(null);
  const [justRequested, setJustRequested] = useState<Set<string>>(new Set());
  const [expandedOrgId, setExpandedOrgId] = useState<string | null>(null);

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
    { value: 'granted', label: 'Access granted', count: data.granted.length },
    { value: 'requested', label: 'Access requested' },
    { value: 'expired', label: 'Expired', count: data.expired.length },
  ];

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-lg font-bold text-gray-900">Access granted</h1>
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
          <div data-tour-id="access-granted-list" className="space-y-3">
            {data.granted.map((card) => {
              const expanded = expandedOrgId === card.orgId;
              const totalDocs = card.folders.reduce((n, f) => n + f.documents.length, 0);
              return (
                <div key={card.orgId} className="rounded-lg border border-gray-200 bg-white p-4">
                  <button onClick={() => setExpandedOrgId(expanded ? null : card.orgId)} className="flex w-full items-center justify-between text-left">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">{card.orgName}</div>
                      <div className="text-xs text-gray-400">
                        {totalDocs} document{totalDocs === 1 ? '' : 's'}
                        {card.grantedAt && ` · granted ${fmtDate(card.grantedAt)}`}
                      </div>
                    </div>
                    <span className="text-xs text-gray-400">{expanded ? '▾' : '▸'}</span>
                  </button>
                  {expanded && (
                    <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
                      {card.folders.map((f) => (
                        <div key={f.folderName}>
                          <div className="text-xs font-semibold text-gray-500">{f.folderName}</div>
                          <ul className="mt-1 space-y-1">
                            {f.documents.map((d) => (
                              <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
                                <span className="text-gray-700">{d.name}</span>
                                <div className="flex items-center gap-2">
                                  {d.expiresAt && <span className="text-[11px] text-gray-400">until {fmtDate(d.expiresAt)}</span>}
                                  {d.url ? (
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
        )
      )}

      {subTab === 'requested' && (
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-6 text-center">
          <p className="text-sm text-gray-500">
            {accessRequestsAvailable
              ? 'No pending requests right now.'
              : 'Coming soon — this tab will show access you\'ve requested but the founder hasn\'t granted yet.'}
          </p>
        </div>
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
