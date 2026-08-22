'use client';
// Prompt 306 — "See how investors see this profile": a read-only preview
// so a founder can see exactly what an investor sees at each disclosure-
// ladder level, to build confidence about filling in more information.
// Calls /api/settings/dossier-preview, which reuses the EXACT SAME
// fetchDossierRawData + projectDossier sequence the real investor-facing
// route (/api/portal/startup/[orgId]) uses — see dossier-fetch.ts's own
// header for why this is never a second implementation of the filter.
//
// Deliberately NOT a real investor relationship: no Pass/Interested, no
// "request more access", no Messages tab, nothing that implies an
// investor is on the other side — readOnly on DossierOverviewSections
// keeps even the section-level CTAs (e.g. "Request contact →") off.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { useTrackPageView } from '@/lib/use-track-page-view';
import { calcCompanyCompleteness } from '@/lib/companyCompleteness';
import { DossierOverviewSections, type Card as DossierCard, type Dossier } from '@/components/portal/DossierOverviewSections';

type Level = 0 | 1 | 2 | 3;

const LEVELS: { level: Level; label: string }[] = [
  { level: 0, label: 'Level 0 · Discovery' },
  { level: 1, label: 'Level 1 · Interested' },
  { level: 2, label: 'Level 2 · Full profile' },
  { level: 3, label: 'Level 3 · Contact granted' },
];

export default function DossierPreviewPage() {
  useTrackPageView('/settings/preview');
  const { db } = useStore();
  // Pedido: "abre sempre no nível máximo (3)".
  const [level, setLevel] = useState<Level>(3);
  const [data, setData] = useState<{ dossier: Dossier; swotToggleOn: boolean; roadmapToggleOn: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    fetch(`/api/settings/dossier-preview?level=${level}`).then((r) => r.json()).then((body) => {
      if (!cancelled) setData(body.ok ? body : null);
    });
    return () => { cancelled = true; };
  }, [level]);

  const completeness = calcCompanyCompleteness(db.org, db.companyPeople).pct;

  // The "compact Pipeline card" tier — Discovery-visible to ANY investor
  // regardless of disclosure level (see /api/portal/startup/[orgId]'s own
  // header comment on `card`), so it's populated here from the founder's
  // own org unconditionally, same as the real page always has it from the
  // Pipeline fetch. Fields DossierOverviewSections doesn't read (matchScore,
  // status, etc.) are harmless placeholders — never rendered.
  const card: DossierCard = {
    orgId: db.org.id, name: db.org.name, oneLiner: db.org.one_liner ?? null, description: db.org.description ?? null,
    sectors: db.org.sectors ?? [], stage: db.org.stage ?? null, hqCity: db.org.hq_city ?? null, country: db.org.country ?? null,
    roundTargetEur: db.org.round_target_eur ?? null, roundMinTicketEur: db.org.round_min_ticket_eur ?? null,
    roundValuationEur: db.org.round_valuation_eur ?? null, roundValuationBasis: db.org.round_valuation_basis ?? null,
    roundInstruments: db.org.round_instruments ?? [],
    matchScore: 0, matchReasons: [], status: 'open', passReason: null, decidedAt: null, decidedByMe: null,
    trackingCount: 0, hasDataRoomAccess: false, viaGrant: false, viaDecision: false, isArchived: false,
  };

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <Link href="/settings" className="text-xs text-gray-400 hover:underline">← Back to Settings</Link>

      <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900">👁 How investors see {db.org.name || 'your company'}</h1>
          <p className="mt-1 max-w-2xl text-xs text-gray-500">
            Investors start at level 0 and climb one step at a time as you grant them access — this shows exactly what
            each step reveals. This is a preview, not a real relationship: nothing here sends a message, grants
            access, or notifies anyone.
          </p>
        </div>
        <div className="shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-center text-xs text-gray-500">
          Profile strength
          <div className="text-base font-semibold text-gray-900">{completeness}%</div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {LEVELS.map((l) => (
          <button key={l.level} onClick={() => setLevel(l.level)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${level === l.level ? 'bg-[#0E7490] text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {l.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {!data ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : (
          <DossierOverviewSections
            card={card} level={level} dossier={data.dossier} readOnly
            swotOffHref={data.swotToggleOn ? undefined : '/readiness?tab=review#swot-visibility-toggle'}
            roadmapOffHref={data.roadmapToggleOn ? undefined : '/settings?tab=company#roadmap-visibility-toggle'}
          />
        )}
      </div>
    </div>
  );
}
