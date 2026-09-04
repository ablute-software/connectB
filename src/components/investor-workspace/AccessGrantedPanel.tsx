'use client';
// Investor Workspace — "Data room" (Prompt 121 §2.5, renamed and grown by
// Prompt 337/338 into the investor-side mirror of the founder's own Vault:
// everything startups have opened to this investor, grouped by startup,
// nothing they can share onward — strictly read-only, no share/grant button
// anywhere in this file). Three sub-tabs kept as-is (Granted/Requested/
// Expired); Prompt 338's own scope is enriching Granted specifically.
import { useEffect, useState } from 'react';

type SubTab = 'granted' | 'requested' | 'expired';

// Prompt 560 §B — `url` is gone. The list carries names and state; the URL
// is minted by /api/portal/open at click time, which is also what records
// the view.
interface GrantedDoc { id: string; name: string; expiresAt: string | null; sharedAt: string; locked: boolean; isNew: boolean; folderName: string }
interface GrantedCard {
  orgId: string; orgName: string; logoUrl: string | null; level: 0 | 1 | 2 | 3 | null;
  grantedAt: string | null; pendingNdaCount: number; folders: { folderName: string; documents: GrantedDoc[] }[];
}
interface ExpiredCard { orgId: string; orgName: string; expiredAt: string | null; count: number }
interface RequestedCard { orgId: string; orgName: string; status: 'pending' | 'declined'; requestedAt: string; respondedAt: string | null }
interface AccessGrantedResponse { granted: GrantedCard[]; requested: RequestedCard[]; expired: ExpiredCard[] }

// Prompt 372 Block G — the investor's own status view of documents they
// asked for. Deliberately carries NOTHING about founder activity (no
// response times, no counts, no percentages) — only what happened to each
// item of THIS investor's own request.
interface DocRequestItem {
  id: string; label: string; status: 'pending' | 'granted' | 'promised' | 'declined';
  fulfilledDocumentName: string | null; promisedFor: string | null; declineReason: string | null; resolutionNote: string | null;
  itemType: 'cap_table' | null;
}
interface DocRequestCard { orgId: string; orgName: string; id: string; message: string | null; requestedAt: string; seen: boolean; items: DocRequestItem[] }

const ITEM_STATUS_LABEL: Record<DocRequestItem['status'], string> = {
  pending: 'Waiting on founder', granted: 'Granted', promised: 'Promised', declined: 'Declined',
};
const ITEM_STATUS_STYLE: Record<DocRequestItem['status'], string> = {
  pending: 'bg-amber-50 text-amber-700', granted: 'bg-emerald-50 text-emerald-700',
  promised: 'bg-[#E8F4F8] text-[#0E7490]', declined: 'bg-gray-100 text-gray-500',
};

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
  const [docRequests, setDocRequests] = useState<DocRequestCard[] | null>(null);
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

  // Block G — document requests are keyed per org (the API needs an
  // orgId), so gather every org this investor has ever touched (granted,
  // requested-for-access, or expired) and fetch each one's document
  // requests separately, then flatten. Small N in practice (one investor's
  // own pipeline of startups), so N small fetches beats a new cross-org
  // endpoint just for this.
  useEffect(() => {
    if (!data) return;
    const orgs = new Map<string, string>();
    for (const c of data.granted) orgs.set(c.orgId, c.orgName);
    for (const c of data.requested) orgs.set(c.orgId, c.orgName);
    for (const c of data.expired) orgs.set(c.orgId, c.orgName);
    if (orgs.size === 0) { setDocRequests([]); return; }
    Promise.all([...orgs.entries()].map(([orgId, orgName]) =>
      fetch(`/api/portal/document-requests?orgId=${encodeURIComponent(orgId)}`).then((r) => r.json())
        .then((d) => (d.requests ?? []).map((r: { id: string; message: string | null; requestedAt: string; items: DocRequestItem[] }) => ({ orgId, orgName, ...r })))
        .catch(() => []),
    )).then((lists) => setDocRequests(lists.flat())).catch(() => setDocRequests([]));
  }, [data]);

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

  const pendingDocRequestItemCount = (docRequests ?? []).reduce(
    (n, r) => n + r.items.filter((i) => i.status === 'pending').length, 0,
  );
  const SUB_TABS: { value: SubTab; label: string; count?: number }[] = [
    { value: 'granted', label: 'Granted', count: data.granted.length },
    { value: 'requested', label: 'Requested', count: data.requested.filter((r) => r.status === 'pending').length + pendingDocRequestItemCount },
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
                          <div className="flex items-center gap-3">
                            <a href={`/portal/startup/${card.orgId}?tab=documents`} className="text-xs font-medium text-[#0E7490] hover:underline">
                              Open in {card.orgName}&apos;s dossier →
                            </a>
                            <a href={`/portal/startup/${card.orgId}?tab=documents`} className="text-xs text-gray-400 hover:text-[#0E7490] hover:underline">
                              Request more documents
                            </a>
                          </div>
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
                                      {/* Prompt 560 §B — this used to be an
                                          <a href={d.url}> on a signed URL the
                                          LIST endpoint minted up front for
                                          every document. Two consequences,
                                          both real: clicking it made no
                                          request, so nothing recorded the
                                          open (Nuno's "1 document to open"
                                          action survived reading the
                                          document); and a live signed URL for
                                          every document sat in the DOM from
                                          page load, outliving a revoke for
                                          its whole TTL. /api/portal/open
                                          re-checks the grants, mints the URL
                                          at click time and logs the view. */}
                                      {d.locked ? (
                                        <span className="text-xs text-gray-300">Pending NDA</span>
                                      ) : (
                                        <a href={`/api/portal/open/${encodeURIComponent(d.id)}`} target="_blank" rel="noreferrer"
                                          className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#0c637b]">
                                          Open
                                        </a>
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
        ) : data.requested.length === 0 && (docRequests ?? []).length === 0 ? (
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
            {/* Block G — document requests, per item. Never shows anything
                about founder activity: no response time, no counts beyond
                "n of N resolved" for THIS investor's own request. */}
            {(docRequests ?? []).map((r) => {
              const resolvedCount = r.items.filter((i) => i.status !== 'pending').length;
              return (
                <div key={r.id} className="rounded-lg border border-gray-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">
                        {r.orgName} · document request
                        {/* Prompt 434 §A/§B — seen is per-REQUEST (investor_
                            seen_response_at), unlike d.isNew above which is
                            genuinely per-document — one badge on the card,
                            not repeated on every item row. */}
                        {!r.seen && <span className="ml-1.5 rounded-full bg-[#E8F4F8] px-1.5 py-0.5 text-[10px] font-semibold text-[#0E7490]">New</span>}
                      </div>
                      <div className="text-xs text-gray-400">
                        requested {fmtDate(r.requestedAt)} · {resolvedCount} of {r.items.length} resolved
                      </div>
                    </div>
                  </div>
                  {r.message && <p className="mt-2 text-xs italic text-gray-500">&quot;{r.message}&quot;</p>}
                  <ul className="mt-2 space-y-1.5">
                    {r.items.map((item) => (
                      <li key={item.id} className="flex flex-col gap-0.5 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-gray-700">{item.label}</span>
                          <div className="flex items-center gap-2">
                            {item.status === 'promised' && item.promisedFor && (
                              <span className="text-[11px] text-gray-400">by {fmtDate(item.promisedFor)}</span>
                            )}
                            {item.status === 'declined' && item.declineReason && (
                              <span className="text-[11px] text-gray-400" title={item.declineReason}>{item.declineReason}</span>
                            )}
                            {item.status === 'granted' && item.fulfilledDocumentName && (
                              <span className="text-[11px] text-gray-400">{item.fulfilledDocumentName}</span>
                            )}
                            <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${ITEM_STATUS_STYLE[item.status]}`}>
                              {ITEM_STATUS_LABEL[item.status]}
                            </span>
                          </div>
                        </div>
                        {item.status === 'granted' && item.resolutionNote && (
                          <p className="text-[11px] text-gray-500">{item.resolutionNote}</p>
                        )}
                        {item.status === 'granted' && item.itemType === 'cap_table' && (
                          <a href={`/portal/startup/${r.orgId}#team`} className="text-[11px] font-medium text-[#0E7490] hover:underline">
                            View in Team →
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
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
