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

interface Card {
  orgId: string; name: string; oneLiner: string | null; description: string | null;
  sectors: string[]; stage: string | null; hqCity: string | null; country: string | null;
  roundTargetEur: number | null; roundMinTicketEur: number | null; roundValuationEur: number | null;
  roundValuationBasis: 'pre_money' | 'post_money' | null; roundInstruments: string[];
  matchScore: number; matchReasons: string[]; status: 'open' | 'passed' | 'interested'; passReason: string | null;
  decidedAt: string | null; decidedByMe: boolean | null; trackingCount: number; hasDataRoomAccess: boolean;
  viaGrant: boolean; viaDecision: boolean; isArchived: boolean;
}
interface Overview {
  org_name: string | null; one_liner: string | null; description: string | null;
  country: string | null; hq_city: string | null; sectors: string[] | null;
  founded_year: number | null; round_target_eur: number | null; revenue_eur: number | null; stage: string | null;
  tam_eur: number | null; sam_eur: number | null; som_eur: number | null;
  revenue_projection_12mo_eur: number | null; revenue_projection_5yr_eur: number | null;
  traction_metrics: Record<string, unknown> | null;
  founders: { full_name: string; title: string | null; bio: string | null; photo_url: string | null }[] | null;
  team_summary: string | null; representative_name: string | null; representative_linkedin: string | null;
}
interface PortalDoc { id: string; name: string; version?: string; watermark: boolean; downloadable: boolean; folder_id?: string; url: string | null }
interface DocSection { key: string; label: string; documents: PortalDoc[] }

const STAGE_LABELS: Record<string, string> = { pre_seed: 'Pre-seed', seed: 'Seed', series_a: 'Series A', series_b_plus: 'Series B+', growth: 'Growth' };
const REASON_MAX_LEN = 1000;

function fmtEur(n: number | null | undefined) {
  return n == null ? null : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
}
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
  const [data, setData] = useState<{ card: Card; overview: Overview | null } | null | 'not-found'>(null);
  const [tab, setTab] = useState<'overview' | 'documents' | 'messages' | 'activity'>('overview');
  const [docs, setDocs] = useState<{ sections: DocSection[]; pendingNdaCount: number } | null>(null);

  const [confirming, setConfirming] = useState<'pass' | 'interest' | null>(null);
  const [reasonDraft, setReasonDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [qaToast, setQaToast] = useState<string | null>(null);

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

  function startConfirm(action: 'pass' | 'interest') {
    setActionError(null); setReasonDraft(''); setConfirming(action);
  }
  function cancelConfirm() { setConfirming(null); setReasonDraft(''); }

  async function act(action: 'pass' | 'interest', reason?: string) {
    setBusy(true); setActionError(null); setQaToast(null);
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
        if (body.qa) setQaToast('QA session — action simulated, nothing recorded.');
      }
      load();
    } finally { setBusy(false); }
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

  const { card, overview } = data;

  return (
    <div className="min-h-screen bg-[#F7F9FA]">
      <div className="sticky top-0 z-10 border-b border-gray-100 bg-white/95 px-4 py-3 backdrop-blur md:px-8">
        <Link href="/portal" className="text-xs text-gray-400 hover:underline">← Back to Pipeline</Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-gray-900">{card.name}</h1>
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
            {card.hasDataRoomAccess ? (
              <span className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-500">Data room open</span>
            ) : (
              <span className="rounded-lg border border-dashed border-gray-200 px-2.5 py-1.5 text-xs text-gray-400">Access granted by the founder</span>
            )}
            {card.isArchived && <span className="rounded-full bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-500">📦 Archived</span>}
          </div>
        </div>

        {actionError && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-[#B00000]">{actionError}</p>}
        {qaToast && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{qaToast}</p>}

        <div className="mt-2">
          {card.status === 'passed' ? (
            <p className="text-xs text-gray-400">Passed{fmtDecidedAt(card.decidedAt, card.decidedByMe)}{card.passReason && ` — ${card.passReason}`}</p>
          ) : card.status === 'interested' ? (
            <div className="flex items-center gap-2">
              <p className="text-xs font-medium text-[#0E7490]">Interest expressed{fmtDecidedAt(card.decidedAt, card.decidedByMe)}</p>
              {!card.isArchived && (
                <button onClick={archiveManually} disabled={busy} className="text-xs text-gray-400 hover:underline disabled:opacity-40">Archive</button>
              )}
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

      <main className="mx-auto max-w-2xl p-4 md:p-8">
        {tab === 'overview' && <OverviewTab card={card} overview={overview} />}
        {tab === 'documents' && <DocumentsTab hasAccess={card.hasDataRoomAccess} docs={docs} />}
        {tab === 'messages' && (
          <div className="mx-auto mt-8 max-w-sm rounded-lg border border-dashed border-gray-200 bg-white p-6 text-center">
            <p className="text-sm text-gray-600">Messages are coming soon (P134-C).</p>
            <p className="mt-1 text-xs text-gray-400">A real conversation between your firm and this startup, in one thread.</p>
          </div>
        )}
        {tab === 'activity' && <InteractionLogTimeline orgId={orgId} />}
      </main>
    </div>
  );
}

function OverviewTab({ card, overview }: { card: Card; overview: Overview | null }) {
  const hasMarket = overview && (overview.tam_eur != null || overview.sam_eur != null || overview.som_eur != null);
  const hasTeam = overview && (overview.team_summary || overview.representative_name);
  const traction = overview?.traction_metrics && typeof overview.traction_metrics === 'object'
    ? Object.entries(overview.traction_metrics as Record<string, unknown>) : [];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">About</h2>
        <p className="mt-1 text-sm text-gray-700">{overview?.description || card.oneLiner || 'Not shared yet.'}</p>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-400">
          {card.sectors.length > 0 && <span>{card.sectors.join(', ')}</span>}
          {overview?.founded_year && <span>Founded {overview.founded_year}</span>}
          {(overview?.hq_city || overview?.country) && <span>{[overview?.hq_city, overview?.country].filter(Boolean).join(', ')}</span>}
        </div>
      </div>

      {(card.roundTargetEur != null || card.roundValuationEur != null || card.roundMinTicketEur != null || card.roundInstruments.length > 0) && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">Round</h2>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            {fmtEur(card.roundTargetEur) && <div><dt className="text-xs text-gray-400">Target</dt><dd>{fmtEur(card.roundTargetEur)}</dd></div>}
            {fmtEur(card.roundValuationEur) && (
              <div>
                <dt className="text-xs text-gray-400">Valuation ({(card.roundValuationBasis ?? 'pre_money') === 'post_money' ? 'post-money' : 'pre-money'})</dt>
                <dd>{fmtEur(card.roundValuationEur)}</dd>
              </div>
            )}
            {fmtEur(card.roundMinTicketEur) && <div><dt className="text-xs text-gray-400">Min ticket</dt><dd>{fmtEur(card.roundMinTicketEur)}</dd></div>}
            {card.roundInstruments.length > 0 && <div><dt className="text-xs text-gray-400">Instrument</dt><dd>{card.roundInstruments.join(', ')}</dd></div>}
          </dl>
        </div>
      )}

      {hasMarket && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">Market</h2>
          <dl className="mt-2 grid grid-cols-3 gap-x-4 gap-y-2 text-sm">
            {overview!.tam_eur != null && <div><dt className="text-xs text-gray-400">TAM</dt><dd>{fmtEur(overview!.tam_eur)}</dd></div>}
            {overview!.sam_eur != null && <div><dt className="text-xs text-gray-400">SAM</dt><dd>{fmtEur(overview!.sam_eur)}</dd></div>}
            {overview!.som_eur != null && <div><dt className="text-xs text-gray-400">SOM</dt><dd>{fmtEur(overview!.som_eur)}</dd></div>}
          </dl>
        </div>
      )}

      {hasTeam && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">Team</h2>
          {overview?.team_summary && <p className="mt-1 text-sm text-gray-700">{overview.team_summary}</p>}
          {overview?.representative_name && (
            <p className="mt-1 text-xs text-gray-500">
              {overview.representative_name}
              {overview.representative_linkedin && (
                <> · <a href={overview.representative_linkedin} target="_blank" rel="noreferrer" className="text-[#0E7490] hover:underline">LinkedIn</a></>
              )}
            </p>
          )}
          {(overview?.founders ?? []).map((f, i) => (
            <p key={i} className="mt-1 text-xs text-gray-500">{f.full_name}{f.title && ` — ${f.title}`}</p>
          ))}
        </div>
      )}

      {traction.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">Traction</h2>
          <div className="mt-2 flex flex-wrap gap-4">
            {traction.map(([label, value]) => (
              <div key={label}><div className="text-xs text-gray-400">{label}</div><div className="text-sm font-semibold text-gray-900">{String(value)}</div></div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DocumentsTab({ hasAccess, docs }: { hasAccess: boolean; docs: { sections: DocSection[]; pendingNdaCount: number } | null }) {
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
    </div>
  );
}
