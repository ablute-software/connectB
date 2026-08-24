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
import { ScorecardPanel } from '@/components/investor-workspace/ScorecardPanel';
import { DocScorePanel, type DocScore } from '@/components/investor-workspace/DocScorePanel';
import { WatsonEvaluationSupport } from '@/components/investor-workspace/WatsonEvaluationSupport';
import { Tooltip } from '@/components/ui';
import { computeDilution, type ValuationBasis } from '@/lib/dilution';

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

  // Prompt 347 — "Track & Evaluate" mode. Off by default until the
  // investor's own remembered preference loads; the mode/columns survive
  // navigation between Overview/Documents/Messages/Activity on purpose —
  // this state lives at the page level, never inside a per-tab component.
  const [trackEvaluate, setTrackEvaluate] = useState(false);
  useEffect(() => {
    fetch('/api/portal/track-evaluate-mode').then((r) => r.json()).then((d) => { if (d.enabled) setTrackEvaluate(true); }).catch(() => {});
  }, []);
  function toggleTrackEvaluate() {
    const next = !trackEvaluate;
    setTrackEvaluate(next);
    fetch('/api/portal/track-evaluate-mode', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: next }),
    }).catch(() => {});
  }
  // Prompt 347 §B — this investor's own scores for every document already
  // fetched for this org, keyed by documentId; the Documents tab reads it
  // to badge already-scored rows, DocScorePanel reads/writes the focused
  // one. Fetched once docs are known — investor-private, never touches any
  // founder-facing payload.
  const [docScores, setDocScores] = useState<Record<string, DocScore>>({});
  useEffect(() => {
    if (!docs) return;
    fetch(`/api/portal/doc-scores?orgId=${encodeURIComponent(orgId)}`).then((r) => r.json()).then((d) => setDocScores(d.scores ?? {})).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!docs, orgId]);
  const [focusedDoc, setFocusedDoc] = useState<{ id: string; name: string } | null>(null);

  // Prompt 348 §A/§B — "Watching closely". Fetched once eligibility is
  // known, independent of the active tab (same reasoning as messagesInfo).
  const [watchInfo, setWatchInfo] = useState<{
    status: 'none' | 'requested' | 'active';
    changedFields?: { field: string; label: string; from: unknown; to: unknown }[];
    newClass1Statements?: string[]; newClass2Statements?: string[]; newRoadmapCount?: number;
  } | null>(null);
  const [watchBusy, setWatchBusy] = useState(false);
  // Prompt 352 §B — never a request fired by a bare click: 'request' shows
  // the explanation + Confirm/Cancel before anything is sent; 'cancel'/
  // 'stop' are the micro-confirms for undoing a pending request or ending
  // an active one. Local UI state only — nothing here is itself a request.
  const [watchConfirm, setWatchConfirm] = useState<'request' | 'cancel' | 'stop' | null>(null);
  // Prompt 354 §C — inline mini equity calculator, expanded in the free
  // space right below the header on click (no modal — never `fixed`, per
  // the usual overlay containing-block trap). '' means "not yet touched by
  // the investor" so it can default to the deal's own min ticket once the
  // card loads, without fighting a value they already typed.
  const [equityCalcOpen, setEquityCalcOpen] = useState(false);
  const [equityTicket, setEquityTicket] = useState('');
  // Prompt 348 §D — founder-authored updates addressed to this investor,
  // through the private watching channel (never My Network).
  const [watchUpdates, setWatchUpdates] = useState<{ id: string; body: string; createdAt: string }[]>([]);
  useEffect(() => {
    if (data === 'not-found' || !data) return;
    fetch(`/api/portal/watch-updates?orgId=${encodeURIComponent(orgId)}`).then((r) => r.json()).then((d) => setWatchUpdates(d.updates ?? [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, orgId]);
  function loadWatch() {
    fetch(`/api/portal/watch?orgId=${encodeURIComponent(orgId)}`).then((r) => r.json()).then(setWatchInfo).catch(() => {});
  }
  useEffect(() => {
    if (data === 'not-found' || !data) return;
    loadWatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, orgId]);

  async function requestWatchThisStartup() {
    setWatchBusy(true);
    try {
      await fetch('/api/portal/watch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orgId }) });
      loadWatch();
    } finally { setWatchBusy(false); }
  }
  async function confirmRequestWatch() {
    setWatchConfirm(null);
    await requestWatchThisStartup();
  }
  // Prompt 352 §B — cancels a still-pending request (the server deletes the
  // row outright — nothing for the founder to have ever seen survives) or
  // ends an active watch (the server revokes it, same effect the founder's
  // own "Stop watching" already has via /api/founder/watches).
  async function cancelWatch() {
    setWatchBusy(true);
    try {
      await fetch('/api/portal/watch', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orgId }) });
      setWatchConfirm(null);
      loadWatch();
    } finally { setWatchBusy(false); }
  }
  async function markWatchSeenHere() {
    await fetch('/api/portal/watch', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orgId }) });
    loadWatch();
  }

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
            {/* Prompt 354 §A — visual hierarchy: Track & Evaluate is the
                PRIMARY action (solid teal, matches the house's primary
                button style elsewhere — e.g. "Express interest" below —
                and stays visibly filled once on, not just a tinted
                outline). Watch is secondary; Equity calculator/Export deal
                memo are tertiary (own smaller group further right); Data
                room state is a non-interactive chip (§A.4), never styled
                like a button. Prompt 347 — off by default (until the
                remembered preference loads), zero layout change with the
                mode off: no empty columns, no CLS. */}
            <button onClick={toggleTrackEvaluate}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${trackEvaluate ? 'bg-[#0E7490] text-white ring-2 ring-[#0E7490] ring-offset-1' : 'bg-[#0E7490] text-white hover:bg-[#0c637b]'}`}>
              📝 Track &amp; Evaluate{trackEvaluate ? ' · on' : ''}
            </button>
            {/* Prompt 348 §A — double opt-in: this only ever creates a
                'requested' row; the founder accepts/declines separately.
                Prompt 352 §B — never fired by a bare click (explanation +
                confirm first), and both "Watching"/"Watch requested" are now
                clickable to undo — they used to be dead <span>s, which read
                as a stuck state with no way back. */}
            {watchInfo?.status === 'active' ? (
              watchConfirm === 'stop' ? (
                <div className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2 py-1">
                  <span className="text-xs text-gray-600">Stop watching?</span>
                  <button onClick={cancelWatch} disabled={watchBusy} className="text-xs font-medium text-[#B00000] hover:underline disabled:opacity-40">Stop</button>
                  <button onClick={() => setWatchConfirm(null)} className="text-xs text-gray-400 hover:underline">Keep</button>
                </div>
              ) : (
                <button onClick={() => setWatchConfirm('stop')}
                  className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-500 hover:border-[#B00000] hover:text-[#B00000]">
                  👁 Watching
                </button>
              )
            ) : watchInfo?.status === 'requested' ? (
              watchConfirm === 'cancel' ? (
                <div className="flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 bg-white px-2 py-1">
                  <span className="text-xs text-gray-500">Cancel watch request?</span>
                  <button onClick={cancelWatch} disabled={watchBusy} className="text-xs font-medium text-[#B00000] hover:underline disabled:opacity-40">Cancel it</button>
                  <button onClick={() => setWatchConfirm(null)} className="text-xs text-gray-400 hover:underline">Keep</button>
                </div>
              ) : (
                <button onClick={() => setWatchConfirm('cancel')}
                  className="rounded-lg border border-dashed border-gray-200 px-2.5 py-1.5 text-xs text-gray-400 hover:border-gray-400 hover:text-gray-500">
                  Watch requested
                </button>
              )
            ) : watchConfirm === 'request' ? (
              <div className="max-w-[260px] rounded-lg border border-gray-200 bg-white px-3 py-2">
                <p className="text-xs text-gray-600">
                  Watching moves this startup out of your active pipeline analysis — you won&apos;t be evaluating it right
                  now, but you&apos;ll receive alerts when something you can see changes.
                </p>
                <p className="mt-1 text-[11px] text-gray-400">Nothing new is disclosed — only changes to what the founder already shares with you.</p>
                <div className="mt-2 flex items-center gap-2">
                  <button onClick={() => setWatchConfirm(null)} className="text-xs text-gray-400 hover:underline">Cancel</button>
                  <button onClick={confirmRequestWatch} disabled={watchBusy}
                    className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">
                    Confirm
                  </button>
                </div>
              </div>
            ) : (
              // Prompt 354 §B — the tooltip now leads with the literal
              // warning Nuno asked for (what watching costs you, before
              // what it gives you); the confirm dialog above still carries
              // both this sentence and 352's own reassurance line.
              <Tooltip text="Watching moves this startup out of your active pipeline analysis — you won't be evaluating it right now, but you'll receive alerts when something you can see changes. Click when you want surveillance only.">
                <button onClick={() => setWatchConfirm('request')} disabled={watchBusy}
                  className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-[#0E7490] disabled:opacity-40">
                  👁 Watch this startup
                </button>
              </Tooltip>
            )}
            {/* Prompt 354 §A — tertiary group: smaller, lighter than the
                secondary Watch control above. */}
            <div className="flex items-center gap-1.5 border-l border-gray-200 pl-2">
              <button onClick={() => setEquityCalcOpen((v) => !v)}
                className="rounded-lg px-2 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700">
                🧮 Equity calculator
              </button>
              <Link href={`/portal/startup/${orgId}/memo`}
                className="rounded-lg px-2 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700">
                📄 Export deal memo
              </Link>
            </div>
            {/* Prompt 354 §A.4 — STATE, not an action: no button border, no
                hover-as-action affordance, so it stops inviting the kind of
                accidental click "Watch" used to get before 352-B. */}
            {card.hasDataRoomAccess ? (
              <span className="px-1 text-xs text-gray-400">● Data room open</span>
            ) : (
              <span className="px-1 text-xs text-gray-300">○ Access granted by the founder</span>
            )}
            {card.isArchived && <span className="rounded-full bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-500">📦 Archived</span>}
          </div>
        </div>

        {/* Prompt 354 §C — the mini equity calculator: expands inline in
            the free space right below the header, no modal, never
            `fixed` (same containing-block discipline as everywhere else
            in this app). Pre-filled from the deal's own data already on
            this page — never a second fetch for numbers we already have.
            Reuses computeDilution (dilution.ts) — the SAME math
            ReturnScenarioTool/EvaluationTools use, never reimplemented. */}
        {equityCalcOpen && (
          <div className="mt-2 max-w-sm rounded-lg border border-gray-200 bg-white p-3">
            {card.roundValuationEur == null ? (
              <p className="text-xs text-gray-500">No valuation on file for {card.name}&apos;s round yet — the calculator needs one.</p>
            ) : (() => {
              const ticketEur = Number(equityTicket || card.roundMinTicketEur || 50000) || 0;
              const result = computeDilution({
                ticketEur, roundValuationEur: card.roundValuationEur, roundTargetEur: card.roundTargetEur ?? 0,
                valuationBasis: (card.roundValuationBasis ?? 'pre_money') as ValuationBasis, futureRoundDilutionsPct: [],
              });
              return (
                <>
                  <label className="flex items-center gap-1.5 text-xs text-gray-600">
                    Your ticket
                    <input type="number" value={equityTicket || String(card.roundMinTicketEur ?? 50000)}
                      onChange={(e) => setEquityTicket(e.target.value)}
                      className="w-28 rounded border border-gray-300 px-2 py-1 text-xs" />
                  </label>
                  <p className="mt-2 text-sm text-gray-900">
                    ≈ <b className="text-[#0E7490]">{result.ownershipAfterThisRoundPct.toFixed(2)}%</b> ownership after this round
                  </p>
                  <p className="mt-0.5 text-[11px] text-gray-400">
                    Post-money {fmtEur(result.postMoneyEur)} · {(card.roundValuationBasis ?? 'pre_money') === 'post_money' ? 'post-money' : 'pre-money'} valuation on file
                  </p>
                </>
              );
            })()}
            <Link href={`/portal?tab=evaluation&orgId=${orgId}`} className="mt-2 inline-block text-xs font-medium text-[#0E7490] hover:underline">
              Full calculator →
            </Link>
          </div>
        )}

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
      <main className={tab === 'messages' && !trackEvaluate ? 'mx-auto max-w-4xl p-4 md:p-8' : 'mx-auto max-w-6xl p-4 md:p-8'}>
        {trackEvaluate ? (
          // Prompt 347 §A/§B — the 3-column grid is a `sticky`-in-grid
          // layout, deliberately NOT `position: fixed` to the viewport (the
          // WorkspaceHeader/backdrop-blur incident, CLAUDE.md): a
          // backdrop-blur/transform ancestor silently becomes the
          // containing block for a real fixed element, which this sticky
          // grid item is immune to. Both side columns render unconditional
          // of `tab` — same JSX tree across every sub-tab switch, so they
          // never unmount/remount and the scorecard/focused-doc state
          // survives navigation, exactly as required. Mobile (below lg):
          // stacked, collapsible via <details> — never a second parallel
          // layout, just the same content, disclosed instead of always-open.
          // Prompt 352 §A — real grid columns with RESERVED space (never
          // absolute/floating over the center): 260px_1fr_260px widened to
          // 300px_1fr_300px, per the request not to squeeze the center.
          // Sticky columns get their own max-height + internal scroll
          // (`overflow-y-auto`) so a tall scorecard/doc-score column can
          // never grow past the viewport and spill into content below it —
          // it scrolls WITHIN its own column instead. The `lg` breakpoint
          // (1024px) is where 3 real columns stop fitting comfortably;
          // below it, the stacked/accordion layout takes over, unchanged.
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr_300px] lg:items-start">
            <details className="rounded-lg border border-gray-200 bg-white lg:hidden">
              <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-gray-700">Your scorecard</summary>
              <div className="border-t border-gray-100 p-2 space-y-2">
                <ScorecardPanel orgId={orgId} />
                <WatsonEvaluationSupport orgId={orgId} />
              </div>
            </details>
            <div className="hidden lg:sticky lg:top-24 lg:block lg:max-h-[calc(100vh-6rem)] lg:space-y-2 lg:overflow-y-auto">
              <ScorecardPanel orgId={orgId} />
              <WatsonEvaluationSupport orgId={orgId} />
            </div>

            <div className="min-w-0">{renderTabContent()}</div>

            {focusedDoc && (
              <>
                <details className="rounded-lg border border-gray-200 bg-white lg:hidden" open>
                  <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-gray-700">Rate this document</summary>
                  <div className="border-t border-gray-100 p-2">
                    <DocScorePanel orgId={orgId} documentId={focusedDoc.id} documentName={focusedDoc.name}
                      initial={docScores[focusedDoc.id] ?? null}
                      onSaved={(id, s) => setDocScores((prev) => ({ ...prev, [id]: s }))} />
                  </div>
                </details>
                <div className="hidden lg:sticky lg:top-24 lg:block lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
                  <DocScorePanel orgId={orgId} documentId={focusedDoc.id} documentName={focusedDoc.name}
                    initial={docScores[focusedDoc.id] ?? null}
                    onSaved={(id, s) => setDocScores((prev) => ({ ...prev, [id]: s }))} />
                </div>
              </>
            )}
          </div>
        ) : renderTabContent()}
      </main>
    </div>
  );

  function renderTabContent() {
    return (
      <>
        {tab === 'overview' && (
          <>
            {/* Prompt 348 §B — "no topo do Overview", never touching
                DossierOverviewSections itself (shared by other callers that
                have nothing to do with watching). Only ever shown for an
                ACTIVE watch with a real delta — never invented, always
                citing the actual changed field or claim. */}
            {watchInfo?.status === 'active' && (
              (watchInfo.changedFields?.length ?? 0) + (watchInfo.newClass1Statements?.length ?? 0)
                + (watchInfo.newClass2Statements?.length ?? 0) + (watchInfo.newRoadmapCount ?? 0) > 0
            ) && (
              <div className="mb-4 rounded-lg border border-amber-100 bg-amber-50/50 p-3 text-sm">
                <p className="font-semibold text-gray-800">What changed since your last visit</p>
                <ul className="mt-1.5 space-y-0.5 text-xs text-gray-700">
                  {(watchInfo.changedFields ?? []).map((f) => (
                    <li key={f.field}>{f.label} changed.</li>
                  ))}
                  {(watchInfo.newClass1Statements ?? []).map((s, i) => <li key={`c1-${i}`}>New class-1 evidence: {s}</li>)}
                  {(watchInfo.newClass2Statements ?? []).map((s, i) => <li key={`c2-${i}`}>New class-2 evidence: {s}</li>)}
                  {!!watchInfo.newRoadmapCount && <li>{watchInfo.newRoadmapCount} roadmap milestone{watchInfo.newRoadmapCount === 1 ? '' : 's'} changed.</li>}
                </ul>
                <button onClick={markWatchSeenHere} className="mt-2 rounded-lg border border-amber-200 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-white">
                  Mark as seen
                </button>
              </div>
            )}
            {watchUpdates.length > 0 && (
              <div className="mb-4 space-y-2">
                {watchUpdates.map((u) => (
                  <div key={u.id} className="rounded-lg border border-gray-200 bg-white p-3 text-sm">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Update from the founder · {new Date(u.createdAt).toLocaleDateString()}</p>
                    <p className="mt-1 whitespace-pre-wrap text-gray-700">{u.body}</p>
                  </div>
                ))}
              </div>
            )}
            <DossierOverviewSections card={card} level={level} dossier={dossier} onRequestLevel={requestLevel} levelBusy={levelBusy} scorecardOrgId={card.orgId} />
          </>
        )}
        {tab === 'documents' && (
          <DocumentsTab hasAccess={card.hasDataRoomAccess} docs={docs} sharedInMessages={messagesInfo?.messages ?? []}
            trackEvaluate={trackEvaluate} docScores={docScores} focusedDocId={focusedDoc?.id ?? null}
            onFocusDoc={(id, name) => setFocusedDoc({ id, name })} />
        )}
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
            status: card.status, decidedAt: card.decidedAt,
            onOpenDoc: openDocById,
          }} />
        )}
      </>
    );
  }
}

function DocumentsTab({ hasAccess, docs, sharedInMessages, trackEvaluate, docScores, focusedDocId, onFocusDoc }: {
  hasAccess: boolean; docs: { sections: DocSection[]; pendingNdaCount: number } | null; sharedInMessages: DealMessage[];
  // Prompt 347 §B — off (all four undefined/false) means zero change from
  // before this prompt: no score badges, no "Rate" affordance.
  trackEvaluate?: boolean; docScores?: Record<string, DocScore>; focusedDocId?: string | null;
  onFocusDoc?: (id: string, name: string) => void;
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
    // Prompt 347 §B — opening a document while in Track & Evaluate mode
    // brings it into focus for the right-column scoring panel; off mode
    // never calls this (onFocusDoc is undefined then).
    onFocusDoc?.(doc.id, doc.name);
  }

  // Prompt 347 §B — "documents already evaluated show the score in the doc
  // list, only for the investor" — a small badge, nothing rendered at all
  // when the mode is off or the document has no score yet.
  function ScoreBadge({ documentId }: { documentId: string }) {
    if (!trackEvaluate) return null;
    const s = docScores?.[documentId];
    return (
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        focusedDocId === documentId ? 'bg-[#0E7490] text-white' : s ? 'border border-amber-200 bg-amber-50 text-amber-700' : 'border border-dashed border-gray-200 text-gray-400'}`}>
        {s ? `★ ${s.score}/10` : 'Rate'}
      </span>
    );
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
                  <ScoreBadge documentId={d.id} />
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
                  <ScoreBadge documentId={d.id} />
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
