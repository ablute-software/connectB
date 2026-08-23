'use client';
// P134-B — the startup dossier. URL of its own (bookmarkable, shareable
// with a colleague at the same firm, deep-linkable from an email or
// notification) — the unit "working a startup" (read, documents, evaluate,
// decide) now lives here; the Pipeline itself stays the triage table
// (P134-A). Eligibility is the exact same P132-A union every other portal
// route uses (/api/portal/startup/[orgId] itself enforces it) — a startup
// that isn't in this investor's Pipeline gets a flat 404, same as if the
// org didn't exist at all.
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { authEnabled, browserClient } from '@/lib/supabase';
import { InteractionLogTimeline } from '@/components/investor-workspace/InteractionLogTimeline';
import { DealThreadView, type DealMessage } from '@/components/deal-messages/DealThreadView';
import {
  DossierOverviewSections, fmtEur, type Card, type Dossier,
} from '@/components/portal/DossierOverviewSections';
import { FollowOnBadge } from '@/components/FollowOnBadge';

interface LevelRow { level: 2 | 3; status: 'granted' | 'pending' | 'denied' }
interface PortalDoc { id: string; name: string; version?: string; watermark: boolean; downloadable: boolean; folder_id?: string; url: string | null }
interface DocSection { key: string; label: string; documents: PortalDoc[] }

const STAGE_LABELS: Record<string, string> = { pre_seed: 'Pre-seed', seed: 'Seed', series_a: 'Series A', series_b_plus: 'Series B+', growth: 'Growth' };
const REASON_MAX_LEN = 1000;

function fmtDecidedAt(iso: string | null | undefined, decidedByMe: boolean | null | undefined) {
  if (!iso) return '';
  const date = new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const who = decidedByMe == null ? '' : decidedByMe ? ' by you' : ' by a colleague at your firm';
  return ` on ${date}${who}`;
}

export default function StartupDossierPage() {
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;

  const [sessionEmail, setSessionEmail] = useState<string | null | undefined>(undefined);
  const [data, setData] = useState<{ card: Card; pioneerBadge?: boolean; level: 0 | 1 | 2 | 3; levelRows: LevelRow[]; dossier: Dossier } | null | 'not-found'>(null);
  // Prompt 216 §C — os itens do "Actions required" apontam para
  // /portal/startup/{orgId}?tab=messages|documents; o inicializador lê o
  // query param diretamente (window, client-only) em vez de useSearchParams
  // para não obrigar a página inteira a um boundary de Suspense.
  const [tab, setTab] = useState<'overview' | 'documents' | 'messages' | 'activity'>(() => {
    if (typeof window === 'undefined') return 'overview';
    const t = new URLSearchParams(window.location.search).get('tab');
    return t === 'documents' || t === 'messages' || t === 'activity' ? t : 'overview';
  });
  const [levelBusy, setLevelBusy] = useState(false);
  const [levelError, setLevelError] = useState<string | null>(null);
  const [docs, setDocs] = useState<{ sections: DocSection[]; pendingNdaCount: number } | null>(null);
  // P134-C — fetched regardless of which tab is active: the Documents tab's
  // own "Shared in messages" cross-ref needs this even if the investor
  // never opens the Messages tab this session.
  const [messagesInfo, setMessagesInfo] = useState<{ canMessage: boolean; messages: DealMessage[] } | null>(null);

  const [confirming, setConfirming] = useState<'pass' | 'interest' | null>(null);
  const [reasonDraft, setReasonDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!authEnabled) { setSessionEmail(null); return; }
    browserClient().auth.getUser().then(({ data }) => setSessionEmail(data.user?.email?.toLowerCase() ?? null));
  }, []);

  function load() {
    fetch(`/api/portal/startup/${orgId}`).then(async (r) => (r.status === 404 ? 'not-found' as const : r.json())).then(setData);
  }
  useEffect(() => {
    if (sessionEmail === undefined || sessionEmail === null) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionEmail, orgId]);

  // Documents — only ever fetched when the header/card already says this
  // firm has an active grant. /api/portal/access?orgId= silently falls back
  // to a DIFFERENT org's grants if the requested one isn't among the
  // caller's own active grants (by design, for the Pipeline's pre-existing
  // callers, which never pointed it at an ungranted org) — calling it for a
  // pure-discovery card here would risk showing the wrong startup's
  // documents. Never call it unless hasDataRoomAccess is already true.
  useEffect(() => {
    if (data === 'not-found' || !data?.card.hasDataRoomAccess) return;
    fetch(`/api/portal/access?orgId=${encodeURIComponent(orgId)}`).then((r) => r.json())
      .then((d) => setDocs({ sections: d.sections ?? [], pendingNdaCount: d.pendingNdaCount ?? 0 }));
  }, [data, orgId]);

  // P134-C — fetched once eligibility is known, independent of the active
  // tab (see messagesInfo's own declaration above for why).
  useEffect(() => {
    if (data === 'not-found' || !data) return;
    fetch(`/api/portal/messages?orgId=${encodeURIComponent(orgId)}`).then((r) => r.json())
      .then((d) => setMessagesInfo({ canMessage: !!d.canMessage, messages: d.messages ?? [] }));
  }, [data, orgId]);

  function startConfirm(action: 'pass' | 'interest') {
    setActionError(null); setReasonDraft(''); setConfirming(action);
  }
  function cancelConfirm() { setConfirming(null); setReasonDraft(''); }

  async function act(action: 'pass' | 'interest', reason?: string) {
    setBusy(true); setActionError(null);
    try {
      const res = await fetch('/api/portal/pipeline', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId, action, reason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) {
        setActionError(body.error ?? 'Something went wrong — please try again.');
      } else {
        setConfirming(null); setReasonDraft('');
      }
      load();
    } finally { setBusy(false); }
  }

  async function requestLevel(level: 2 | 3) {
    setLevelBusy(true); setLevelError(null);
    try {
      const res = await fetch('/api/portal/interest-level', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId, level }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) setLevelError(body.error ?? 'Something went wrong — please try again.');
      load();
    } finally { setLevelBusy(false); }
  }

  // Prompt 216 §B — abrir um documento a partir da faixa da jornada: o
  // MESMO caminho com gate do separador Documents (a lista `docs` já vem de
  // /api/portal/access via resolveDocumentAccess; o POST /view regista a
  // visualização como sempre). Um id que não esteja na lista com gate não
  // abre nada — nunca se constrói um URL fora dela.
  async function openDocById(documentId: string) {
    const doc = docs?.sections.flatMap((s) => s.documents).find((d) => d.id === documentId);
    if (!doc) return;
    await fetch('/api/portal/view', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documentId }) });
    window.open(doc.url ?? '#', '_blank');
  }

  async function archiveManually() {
    setBusy(true);
    try {
      await fetch('/api/portal/archive', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archiveOrgId: orgId }),
      });
      load();
    } finally { setBusy(false); }
  }

  if (authEnabled && sessionEmail === undefined) return <div className="mt-16 text-center text-sm text-gray-400">Loading…</div>;
  if (authEnabled && sessionEmail === null) {
    return (
      <div className="mx-auto mt-16 max-w-sm rounded-lg border border-gray-200 bg-white p-6 text-center">
        <h1 className="text-lg font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-gray-500">Sign in to view this startup.</p>
        <Link href={`/login?next=/portal/startup/${orgId}`} className="mt-4 inline-block rounded-lg bg-[#0E7490] px-3 py-2 text-sm font-medium text-white">
          Go to sign in
        </Link>
      </div>
    );
  }
  if (data === 'not-found') {
    return (
      <div className="mx-auto mt-16 max-w-sm rounded-lg border border-gray-200 bg-white p-6 text-center">
        <p className="text-sm text-gray-600">This startup isn&apos;t in your Pipeline.</p>
        <Link href="/portal" className="mt-3 inline-block text-xs text-[#0E7490] hover:underline">← Back to Pipeline</Link>
      </div>
    );
  }
  if (!data) return <div className="mt-16 text-center text-sm text-gray-400">Loading…</div>;

  const { card, pioneerBadge, level, levelRows, dossier } = data;
  const level3Row = levelRows.find((r) => r.level === 3);

  return (
    <div className="min-h-screen bg-[#F7F9FA]">
      <div className="sticky top-0 z-10 border-b border-gray-100 bg-white/95 px-4 py-3 backdrop-blur md:px-8">
        <Link href="/portal" className="text-xs text-gray-400 hover:underline">← Back to Pipeline</Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-lg font-bold text-gray-900">{card.name}</h1>
              {/* Prompt 161 §C.4 — same asset/placement discipline as the
                  founder's own Plans & billing card (PlansPanel.tsx):
                  onError hides it rather than a broken-image icon. */}
              {pioneerBadge && (
                <img src="/badges/pioneer.png" alt="Pioneer" title="Pioneer — permanent badge"
                  className="h-5 w-5" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
              )}
              {(card.followOnSignals ?? []).map((s, i) => <FollowOnBadge key={i} signal={s} />)}
            </div>
            {card.oneLiner && <p className="text-sm text-gray-500">{card.oneLiner}</p>}
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-400">
              {card.stage && <span>{STAGE_LABELS[card.stage] ?? card.stage}</span>}
              {fmtEur(card.roundTargetEur) && <span>raising {fmtEur(card.roundTargetEur)}</span>}
              {card.country && <span>{card.country}</span>}
              <span className="font-semibold text-[#0E7490]">{card.matchScore}% match</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/portal?tab=evaluation&orgId=${orgId}`}
              className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-[#0E7490]">
              🧮 Equity calculator
            </Link>
            <Link href={`/portal/startup/${orgId}/memo`}
              className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-[#0E7490]">
              📄 Export deal memo
            </Link>
            {card.hasDataRoomAccess ? (
              <span className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-500">Data room open</span>
            ) : (
              <span className="rounded-lg border border-dashed border-gray-200 px-2.5 py-1.5 text-xs text-gray-400">Access granted by the founder</span>
            )}
            {card.isArchived && <span className="rounded-full bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-500">📦 Archived</span>}
          </div>
        </div>

        {actionError && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-[#B00000]">{actionError}</p>}

        <div className="mt-2">
          {card.status === 'passed' ? (
            <p className="text-xs text-gray-400">Passed{fmtDecidedAt(card.decidedAt, card.decidedByMe)}{card.passReason && ` — ${card.passReason}`}</p>
          ) : card.status === 'interested' ? (
            <div>
              <div className="flex items-center gap-2">
                <p className="text-xs font-medium text-[#0E7490]">Interest expressed{fmtDecidedAt(card.decidedAt, card.decidedByMe)}</p>
                {!card.isArchived && (
                  <button onClick={archiveManually} disabled={busy} className="text-xs text-gray-400 hover:underline disabled:opacity-40">Archive</button>
                )}
              </div>
              {/* P136 — the disclosure ladder. Level 2 is frictionless (the
                  investor's own act, granted the instant it's asked for);
                  level 3 needs the founder's approval, shown here as
                  "Requested — waiting for {startup}" once pending. */}
              <div className="mt-1.5 flex items-center gap-2">
                {level < 2 && (
                  <button onClick={() => requestLevel(2)} disabled={levelBusy}
                    className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-[#0E7490] disabled:opacity-40">
                    Request full profile
                  </button>
                )}
                {level >= 2 && level < 3 && (
                  level3Row?.status === 'pending' ? (
                    <span className="text-xs text-gray-400">Contact requested — waiting for {card.name}</span>
                  ) : level3Row?.status === 'denied' ? (
                    <span className="text-xs text-gray-400">Contact request declined</span>
                  ) : (
                    <button onClick={() => requestLevel(3)} disabled={levelBusy}
                      className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-[#0E7490] disabled:opacity-40">
                      Request contact
                    </button>
                  )
                )}
                {level >= 3 && <span className="text-xs font-medium text-emerald-700">✓ Contact access granted</span>}
              </div>
              {levelError && <p className="mt-1 text-[11px] text-[#B00000]">{levelError}</p>}
            </div>
          ) : confirming ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              {confirming === 'interest' ? (
                <p className="text-xs text-gray-700">Confirm you&apos;re interested in {card.name}? The founder will be notified.</p>
              ) : (
                <>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Reason for passing (required)</label>
                  <textarea value={reasonDraft} onChange={(e) => setReasonDraft(e.target.value.slice(0, REASON_MAX_LEN))}
                    rows={2} placeholder="Why isn't this a fit right now?" className="w-full max-w-md rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs" />
                  <p className="mt-0.5 text-[10px] text-gray-400">{reasonDraft.length}/{REASON_MAX_LEN} · This decision is final — the data room will be revoked and it can&apos;t be undone.</p>
                </>
              )}
              <div className="mt-2 flex items-center gap-2">
                <button onClick={cancelConfirm} disabled={busy} className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-white disabled:opacity-40">Cancel</button>
                <button onClick={() => act(confirming, confirming === 'pass' ? reasonDraft : undefined)}
                  disabled={busy || (confirming === 'pass' && reasonDraft.trim().length === 0)}
                  className="rounded-lg bg-[#0E7490] px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-40">
                  {busy ? 'Saving…' : confirming === 'interest' ? 'Confirm interest' : 'Confirm pass'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => startConfirm('interest')} disabled={busy}
                className="rounded-lg bg-[#0E7490] px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-40">
                Express interest
              </button>
              <button onClick={() => startConfirm('pass')} className="text-xs text-gray-400 hover:underline">Pass</button>
              <button onClick={archiveManually} disabled={busy} className="text-xs text-gray-400 hover:underline disabled:opacity-40">Archive</button>
            </div>
          )}
        </div>

        <div className="mt-3 flex gap-1">
          {(['overview', 'documents', 'messages', 'activity'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${tab === t ? 'bg-[#0E7490] text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Prompt 213 §A — o dossier vivia numa coluna de ~640px com laterais
          vazias enormes. Passa a largo; a restricao de leitura e do
          PARAGRAFO (max-w dentro do cartao do About), nao da pagina. */}
      <main className={tab === 'messages' ? 'mx-auto max-w-4xl p-4 md:p-8' : 'mx-auto max-w-6xl p-4 md:p-8'}>
        {tab === 'overview' && (
          <DossierOverviewSections card={card} level={level} dossier={dossier} onRequestLevel={requestLevel} levelBusy={levelBusy} scorecardOrgId={card.orgId} />
        )}
        {tab === 'documents' && <DocumentsTab hasAccess={card.hasDataRoomAccess} docs={docs} sharedInMessages={messagesInfo?.messages ?? []} />}
        {tab === 'messages' && (
          <div className="flex flex-col gap-4 md:flex-row">
            <div className="flex-1">
              {messagesInfo == null ? (
                <p className="text-sm text-gray-400">Loading…</p>
              ) : (
                <DealThreadView
                  viewerSide="investor"
                  fetchUrl={`/api/portal/messages?orgId=${encodeURIComponent(orgId)}`}
                  postUrl="/api/portal/messages" extraPostBody={{ orgId }}
                  attachableDocuments={docs ? docs.sections.flatMap((s) => s.documents.map((d) => ({ id: d.id, name: d.name }))) : undefined}
                  disabled={!messagesInfo.canMessage}
                  disabledReason="Messaging opens once you've expressed interest or the founder has granted data-room access."
                />
              )}
            </div>
            <div className="md:w-64 md:shrink-0">
              <ContactHistoryRail orgId={orgId} />
            </div>
          </div>
        )}
        {tab === 'activity' && (
          <InteractionLogTimeline orgId={orgId} journey={{
            messages: messagesInfo?.messages ?? [],
            accessibleDocs: docs ? docs.sections.flatMap((s) => s.documents.map((d) => ({ id: d.id, name: d.name }))) : [],
            status: data.card.status, decidedAt: data.card.decidedAt,
            onOpenDoc: openDocById,
          }} />
        )}
      </main>
    </div>
  );
}

function DocumentsTab({ hasAccess, docs, sharedInMessages }: {
  hasAccess: boolean; docs: { sections: DocSection[]; pendingNdaCount: number } | null; sharedInMessages: DealMessage[];
}) {
  if (!hasAccess) {
    return (
      <div className="mx-auto mt-8 max-w-sm rounded-lg border border-dashed border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
        🔒 Access to documents is granted by the founder — express interest to start the conversation.
      </div>
    );
  }
  if (!docs) return <p className="text-sm text-gray-400">Loading…</p>;

  async function openDoc(doc: PortalDoc) {
    await fetch('/api/portal/view', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documentId: doc.id }) });
    window.open(doc.url ?? '#', '_blank');
  }

  // P134-C — "Shared in messages": the mini-prompt's own "documents
  // exchanged in conversation should stay reachable there" ask. Cross-refs
  // each message's document_ids against the docs already known to be
  // visible to this firm (never surfaces a document id this firm can't
  // otherwise see) plus every link shared in the thread.
  const allDocs = docs.sections.flatMap((s) => s.documents);
  const sharedDocIds = [...new Set(sharedInMessages.flatMap((m) => m.documentIds))];
  const sharedDocs = allDocs.filter((d) => sharedDocIds.includes(d.id));
  const sharedLinks = sharedInMessages.flatMap((m) => m.links);

  return (
    <div className="space-y-4">
      {docs.pendingNdaCount > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Awaiting NDA — {docs.pendingNdaCount} more item{docs.pendingNdaCount === 1 ? '' : 's'} will appear here once your signed NDA is on file.
        </div>
      )}
      {docs.sections.map((s) => (
        <div key={s.key} className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">{s.label}</h2>
          {s.documents.length === 0 ? (
            <p className="mt-1 text-xs text-gray-400">In preparation.</p>
          ) : (
            <div className="mt-2 space-y-2">
              {s.documents.map((d) => (
                <div key={d.id} className="flex items-center gap-3 rounded-lg border border-gray-100 p-3">
                  <span className="text-lg">▤</span>
                  <div className="flex-1">
                    <div className="text-sm font-medium">{d.name}</div>
                    <div className="text-xs text-gray-400">
                      Open{d.version && ` · ${d.version}`}{d.watermark && ' · watermarked'}{!d.downloadable && ' · view only, no download'}
                    </div>
                  </div>
                  <button onClick={() => openDoc(d)} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white">Open</button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {(sharedDocs.length > 0 || sharedLinks.length > 0) && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">Shared in messages</h2>
          {sharedDocs.length > 0 && (
            <div className="mt-2 space-y-2">
              {sharedDocs.map((d) => (
                <div key={d.id} className="flex items-center gap-3 rounded-lg border border-gray-100 p-3">
                  <span className="text-lg">▤</span>
                  <div className="flex-1 text-sm font-medium">{d.name}</div>
                  <button onClick={() => openDoc(d)} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white">Open</button>
                </div>
              ))}
            </div>
          )}
          {sharedLinks.length > 0 && (
            <ul className="mt-2 space-y-1">
              {sharedLinks.map((l, i) => (
                <li key={i}><a href={l.url} target="_blank" rel="noreferrer" className="text-xs text-[#0E7490] hover:underline">{l.label} →</a></li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// P134-B §3.4 — the "ao lado" (right rail) request: a compact contact-
// history summary alongside the Messages tab, reusing the exact same
// timeline the Activity tab shows in full (P133), just condensed.
function ContactHistoryRail({ orgId }: { orgId: string }) {
  const [entries, setEntries] = useState<{ id: string; at: string; content: string; links: { label: string; url: string }[] }[] | null>(null);
  useEffect(() => {
    fetch(`/api/portal/interaction-log?orgId=${encodeURIComponent(orgId)}`).then((r) => r.json()).then((d) => setEntries(d.entries ?? []));
  }, [orgId]);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Contact history</h2>
      {entries == null ? (
        <p className="mt-2 text-xs text-gray-400">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="mt-2 text-xs text-gray-400">No history yet.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {entries.slice(0, 10).map((e) => (
            <li key={e.id} className="text-xs">
              <div className="text-gray-400">{new Date(e.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>
              <p className="text-gray-700">{e.content.length > 80 ? `${e.content.slice(0, 80)}…` : e.content}</p>
              {e.links.map((l, i) => (
                <a key={i} href={l.url} target="_blank" rel="noreferrer" className="block text-[#0E7490] hover:underline">{l.label} →</a>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
