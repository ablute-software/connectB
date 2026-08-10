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

interface TeamMember { id: string; fullName: string; title: string | null; isFounder: boolean; linkedinUrl: string | null }
interface Overview { description?: string | null; one_liner?: string | null }
interface Card {
  name: string; oneLiner: string | null; sectors: string[]; stage: string | null;
  roundTargetEur: number | null; roundMinTicketEur: number | null;
}
interface Dossier { overview?: Overview; team?: TeamMember[] }
interface MemoData { card: Card; dossier: Dossier }

const STAGE_LABELS: Record<string, string> = { pre_seed: 'Pre-seed', seed: 'Seed', series_a: 'Series A', series_b_plus: 'Series B+', growth: 'Growth' };

function fmtEur(n: number | null | undefined) {
  return n == null ? null : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
}

export default function DealMemoPage() {
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;
  const [sessionEmail, setSessionEmail] = useState<string | null | undefined>(undefined);
  const [data, setData] = useState<MemoData | null | 'not-found'>(null);

  useEffect(() => {
    if (!authEnabled) { setSessionEmail(null); return; }
    browserClient().auth.getUser().then(({ data }) => setSessionEmail(data.user?.email ?? null));
  }, []);

  useEffect(() => {
    if (sessionEmail === undefined || sessionEmail === null) return;
    fetch(`/api/portal/startup/${orgId}`).then(async (r) => (r.status === 404 ? 'not-found' as const : r.json())).then(setData);
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

      <div className="pt-2 text-center text-[10px] text-gray-400">Sherlock Deal · deal memo generated {new Date().toISOString().slice(0, 10)}</div>
    </div>
  );
}
