'use client';
// Prompt 142 Bloco 2 — deal memo export. Path (a) chosen over (b)
// (server-side PDF via Playwright): follows the exact precedent already
// set by readiness/report/[id]/page.tsx (its own header comment is
// explicit — "Zero server-side sending: Print is window.print() (never
// jsPDF/…)" — the one time this app built a report export, it deliberately
// avoided a real PDF library). Zero new dependency, and the investor
// chooses "Save as PDF" in their own browser's print dialog.
//
// Reuses GET /api/portal/startup/[orgId] verbatim — the SAME disclosure-
// gated fetch the dossier page itself calls, never a second read path.
// Nothing here is fetched or rendered beyond what that route already
// projects for the investor's current level; a field the ladder hasn't
// unlocked yet is simply absent from the response, so there is nothing to
// accidentally leak by rendering everything the response contains.
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { authEnabled, browserClient } from '@/lib/supabase';
import { weightedCriterionValues, type ScorecardCriterion, type TabScoreRow } from '@/lib/investor-scorecard-summary';

interface TeamMember { id: string; fullName: string; title: string | null; isFounder: boolean; linkedinUrl: string | null }
interface Overview { description?: string | null; one_liner?: string | null }
interface Card {
  name: string; oneLiner: string | null; sectors: string[]; stage: string | null;
  roundTargetEur: number | null; roundMinTicketEur: number | null;
  // Prompt 354 §D — relationship state/dates, already on the SAME card the
  // dossier itself reads (nothing new fetched for these two).
  status: 'open' | 'passed' | 'interested'; decidedAt: string | null; decidedByMe: boolean | null;
}
interface Dossier { overview?: Overview; team?: TeamMember[] }
interface MemoData { card: Card; dossier: Dossier }

// Prompt 354 §D — "Your private evaluation — never shared": the investor's
// OWN scorecard/doc-ratings/ticket-and-deal-signals/reminders for this
// startup, printed as a clearly separate second half of the memo. Every one
// of these is already investor-private data this session's own routes
// serve back to the SAME investor who's asking — nothing founder-private
// enters through this page (root privacy rule is about the OTHER
// direction: founder data reaching investors, not an investor's own notes
// reaching themselves).
interface ScorecardItem { criteriaId: string; label: string; weight: number; score: number | null; note: string | null }
// Prompt 355 §A — matches /api/portal/doc-scores' versioned shape; the memo
// only ever prints the CURRENT rating (a superseded, pre-re-rate score
// belongs in the dossier's own History, not in a printed record).
interface DocScoreEntry { current: { score: number; note: string | null } | null }
interface ReminderItem { id: string; orgId: string | null; title: string; due_at: string | null }
// Prompt 355 §C — "the deal memo can include the summaries of documents you
// rated, when they exist" — cache-only (GET), never triggers generation.
interface DocSummaryEntry { summary: string; highlights: string[] }

const STAGE_LABELS: Record<string, string> = { pre_seed: 'Pre-seed', seed: 'Seed', series_a: 'Series A', series_b_plus: 'Series B+', growth: 'Growth' };
const CONSIDERING_LABEL: Record<string, string> = { lead: 'Leading', co_lead: 'Following', both: 'Both' };
const INSTRUMENT_LABELS: Record<string, string> = { equity: 'Equity', safe: 'SAFE', convertible_note: 'Convertible note', venture_debt: 'Venture debt', grant: 'Grant / subsidy', revenue_based: 'Revenue-based' };

function fmtEur(n: number | null | undefined) {
  return n == null ? null : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
}
function fmtDate(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
}

export default function DealMemoPage() {
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;
  const [sessionEmail, setSessionEmail] = useState<string | null | undefined>(undefined);
  const [data, setData] = useState<MemoData | null | 'not-found'>(null);
  const [scorecard, setScorecard] = useState<ScorecardItem[]>([]);
  const [docScores, setDocScores] = useState<Record<string, DocScoreEntry>>({});
  const [docNames, setDocNames] = useState<Record<string, string>>({});
  const [ticketSignal, setTicketSignal] = useState<{ range_label: string } | null>(null);
  const [dealSignal, setDealSignal] = useState<{ considering: string | null; instruments: string[] } | null>(null);
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [docSummaries, setDocSummaries] = useState<Record<string, DocSummaryEntry>>({});

  useEffect(() => {
    if (!authEnabled) { setSessionEmail(null); return; }
    browserClient().auth.getUser().then(({ data }) => setSessionEmail(data.user?.email ?? null));
  }, []);

  useEffect(() => {
    if (sessionEmail === undefined || sessionEmail === null) return;
    fetch(`/api/portal/startup/${orgId}`).then(async (r) => (r.status === 404 ? 'not-found' as const : r.json())).then(setData);
    // Prompt 354 §D — the private half of the memo, one fetch per already-
    // existing route (scorecard, doc-scores, ticket/deal signals via the
    // same /api/portal/access the dossier itself uses, reminders).
    // Prompt 388 §C.3 — scorecard is now the SAME weighted-average-across-
    // tabs computation ScorecardPanel.tsx itself uses (investor_dossier_
    // tab_scores), never the old, now-frozen investor_scorecard_scores.
    fetch(`/api/portal/scorecard/tab-scores?orgId=${encodeURIComponent(orgId)}`).then((r) => r.json()).then((d) => {
      const criteria = (d.criteria ?? []) as ScorecardCriterion[];
      const rows = (d.rows ?? []) as TabScoreRow[];
      setScorecard(weightedCriterionValues(criteria, rows).map((v) => ({ criteriaId: v.id, label: v.label, weight: v.weight, score: v.value, note: null })));
    }).catch(() => {});
    fetch(`/api/portal/doc-scores?orgId=${encodeURIComponent(orgId)}`).then((r) => r.json()).then((d) => {
      const scores = (d.scores ?? {}) as Record<string, DocScoreEntry>;
      setDocScores(scores);
      const ratedDocIds = Object.keys(scores).filter((id) => scores[id].current);
      if (ratedDocIds.length === 0) return;
      const qs = ratedDocIds.map((id) => `documentId=${encodeURIComponent(id)}`).join('&');
      fetch(`/api/portal/doc-summary?orgId=${encodeURIComponent(orgId)}&${qs}`).then((r) => r.json())
        .then((s) => setDocSummaries(s.summaries ?? {})).catch(() => {});
    }).catch(() => {});
    fetch(`/api/portal/access?orgId=${encodeURIComponent(orgId)}`).then((r) => r.json()).then((d) => {
      setTicketSignal(d.currentTicketSignal ?? null);
      setDealSignal(d.currentDealSignal ?? null);
      const names: Record<string, string> = {};
      for (const doc of (d.documents ?? []) as { id: string; name: string }[]) names[doc.id] = doc.name;
      setDocNames(names);
    }).catch(() => {});
    fetch('/api/portal/tasks').then((r) => r.json()).then((d) => {
      setReminders(((d.tasks ?? []) as ReminderItem[]).filter((t) => t.orgId === orgId));
    }).catch(() => {});
  }, [sessionEmail, orgId]);

  if (authEnabled && sessionEmail === undefined) return <div className="mt-16 text-center text-sm text-gray-400">Loading…</div>;
  if (authEnabled && sessionEmail === null) {
    return (
      <div className="mx-auto mt-16 max-w-sm rounded-lg border border-gray-200 bg-white p-6 text-center">
        <h1 className="text-lg font-semibold">Sign in</h1>
        <Link href={`/login?next=/portal/startup/${orgId}/memo`} className="mt-4 inline-block rounded-lg bg-[#0E7490] px-3 py-2 text-sm font-medium text-white">
          Go to sign in
        </Link>
      </div>
    );
  }
  if (data === 'not-found') {
    return (
      <div className="mx-auto mt-16 max-w-sm rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-600">
        This startup isn&apos;t in your Pipeline.
      </div>
    );
  }
  if (!data) return <div className="mt-16 text-center text-sm text-gray-400">Loading…</div>;

  const { card, dossier } = data;
  const team = dossier.team ?? [];
  const description = dossier.overview?.description || card.oneLiner || 'Not shared yet.';
  const hasRound = card.roundTargetEur != null || card.roundMinTicketEur != null;

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6 print:max-w-none print:p-0">
      <div className="flex items-start justify-between gap-4 print:hidden">
        <Link href={`/portal/startup/${orgId}`} className="text-xs text-gray-400 hover:underline">← Back to {card.name}</Link>
        <button onClick={() => window.print()} className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-600">Download PDF</button>
      </div>

      <div>
        <h1 className="text-xl font-bold text-gray-900">{card.name}</h1>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-400">
          {card.stage && <span>{STAGE_LABELS[card.stage] ?? card.stage}</span>}
          {card.sectors.length > 0 && <span>{card.sectors.join(', ')}</span>}
        </div>
        {/* Prompt 354 §D.2 — a real investment memo names who prepared it
            and when, plus a confidentiality note; the old print-out had
            neither. sessionEmail is the "who" until named-contact
            (level 3) — good enough for "prepared by", never used elsewhere
            on this page as an identity claim. */}
        <p className="mt-2 text-xs text-gray-500">
          Prepared by {sessionEmail ?? 'you'} on {fmtDate(new Date().toISOString())} — confidential, for your own use only.
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 p-4 print:border-0 print:p-0">
        <h2 className="text-sm font-semibold text-gray-900">About</h2>
        <p className="mt-1 text-sm text-gray-700">{description}</p>
      </div>

      <div className="rounded-lg border border-gray-200 p-4 print:border-0 print:p-0">
        <h2 className="text-sm font-semibold text-gray-900">Round</h2>
        {hasRound ? (
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {fmtEur(card.roundTargetEur) && <div><dt className="text-xs text-gray-400">Target</dt><dd>{fmtEur(card.roundTargetEur)}</dd></div>}
            {fmtEur(card.roundMinTicketEur) && <div><dt className="text-xs text-gray-400">Min ticket</dt><dd>{fmtEur(card.roundMinTicketEur)}</dd></div>}
          </dl>
        ) : (
          <p className="mt-1 text-sm text-gray-400">Not shared yet.</p>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 p-4 print:border-0 print:p-0">
        <h2 className="text-sm font-semibold text-gray-900">Team</h2>
        {team.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {team.map((p) => (
              <li key={p.id} className="text-sm text-gray-700">
                {p.fullName}{p.title && <span className="text-gray-400"> — {p.title}</span>}
                {p.isFounder && <span className="ml-1.5 text-xs text-[#0E7490]">Founder</span>}
                {p.linkedinUrl && <span className="ml-1.5 text-xs text-gray-400">· {p.linkedinUrl}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-gray-400">Not shared yet.</p>
        )}
      </div>

      {/* Prompt 354 §D.1 — clearly separate second half: everything above
          this line is the base (public-tier) memo the founder's own
          dossier already shows at this disclosure level; everything below
          is the investor's OWN private evaluation, never shared with or
          derivable by the startup. Regra raiz intocada: this composes only
          what the investor already sees (above) plus what is theirs
          (below) — nothing founder-private-derived enters here. */}
      <div className="border-t-2 border-dashed border-gray-300 pt-4 print:break-before-page">
        <h2 className="text-sm font-bold uppercase tracking-wide text-[#0E7490]">Your private evaluation — never shared</h2>

        <div className="mt-3 rounded-lg border border-gray-200 p-4 print:border-0 print:p-0">
          <h3 className="text-sm font-semibold text-gray-900">Relationship</h3>
          <p className="mt-1 text-sm text-gray-700">
            {card.status === 'passed' ? 'Passed' : card.status === 'interested' ? 'Interest expressed' : 'Under review'}
            {fmtDate(card.decidedAt) && ` on ${fmtDate(card.decidedAt)}`}
            {card.decidedByMe === false && ' (by a colleague at your firm)'}
          </p>
          {ticketSignal && <p className="mt-1 text-sm text-gray-700">Ticket range considered: <b>{ticketSignal.range_label}</b></p>}
          {dealSignal?.considering && <p className="mt-1 text-sm text-gray-700">Considering: <b>{CONSIDERING_LABEL[dealSignal.considering] ?? dealSignal.considering}</b></p>}
          {dealSignal && dealSignal.instruments.length > 0 && (
            <p className="mt-1 text-sm text-gray-700">Type of investment: <b>{dealSignal.instruments.map((v) => INSTRUMENT_LABELS[v] ?? v).join(', ')}</b></p>
          )}
        </div>

        {scorecard.length > 0 && (
          <div className="mt-3 rounded-lg border border-gray-200 p-4 print:border-0 print:p-0">
            <h3 className="text-sm font-semibold text-gray-900">Your scorecard</h3>
            <ul className="mt-2 space-y-1">
              {scorecard.map((it) => (
                <li key={it.criteriaId} className="text-sm text-gray-700">
                  {it.label} (weight {it.weight}): <b>{it.score != null ? `${it.score.toFixed(1)}/10` : 'not scored'}</b>{it.note && <span className="text-gray-500"> — {it.note}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {Object.values(docScores).some((s) => s.current) && (
          <div className="mt-3 rounded-lg border border-gray-200 p-4 print:border-0 print:p-0">
            <h3 className="text-sm font-semibold text-gray-900">Your document ratings</h3>
            <ul className="mt-2 space-y-2">
              {Object.entries(docScores).filter(([, s]) => s.current).map(([docId, s]) => (
                <li key={docId} className="text-sm text-gray-700">
                  <p>{docNames[docId] ?? 'Document'}: <b>{s.current!.score}/10</b>{s.current!.note && <span className="text-gray-500"> — {s.current!.note}</span>}</p>
                  {/* Prompt 355 §C — only when a Sherlock summary already
                      exists for this document (cache-only GET) — never
                      generated on the fly just because the memo printed. */}
                  {docSummaries[docId] && (
                    <p className="mt-0.5 text-xs text-gray-500">{docSummaries[docId].summary}</p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {reminders.length > 0 && (
          <div className="mt-3 rounded-lg border border-gray-200 p-4 print:border-0 print:p-0">
            <h3 className="text-sm font-semibold text-gray-900">Reminders</h3>
            <ul className="mt-2 space-y-1">
              {reminders.map((r) => (
                <li key={r.id} className="text-sm text-gray-700">{r.title}{fmtDate(r.due_at) && ` — due ${fmtDate(r.due_at)}`}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="pt-2 text-center text-[10px] text-gray-400">Sherlock Deal · deal memo generated {new Date().toISOString().slice(0, 10)}</div>
    </div>
  );
}
