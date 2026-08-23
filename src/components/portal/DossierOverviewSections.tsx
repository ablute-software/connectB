'use client';
// Prompt 306 — extracted out of /portal/startup/[orgId]/page.tsx's own
// OverviewTab so the founder-only "see how investors see this profile"
// preview can render the EXACT SAME markup an investor sees, not a
// reconstruction that could quietly drift from it. Every type/const the
// section markup depends on moved here too, so there is exactly one
// definition of "what this looks like" for both callers.
import Link from 'next/link';
import { SectionNav } from '@/components/SectionNav';
import { ScorecardPanel } from '@/components/investor-workspace/ScorecardPanel';
import { SwotQuadrant } from '@/components/readiness/SwotVisualCard';
import { ResponsiveRoadmap } from '@/components/company/ResponsiveRoadmap';
import type { SwotData, RoadmapPeriodKind } from '@/lib/types';
import type { ReviewCategory } from '@/lib/review-clarifications';

export interface Card {
  orgId: string; name: string; oneLiner: string | null; description: string | null;
  sectors: string[]; stage: string | null; hqCity: string | null; country: string | null;
  roundTargetEur: number | null; roundMinTicketEur: number | null; roundValuationEur: number | null;
  roundValuationBasis: 'pre_money' | 'post_money' | null; roundInstruments: string[];
  matchScore: number; matchReasons: string[]; status: 'open' | 'passed' | 'interested'; passReason: string | null;
  decidedAt: string | null; decidedByMe: boolean | null; trackingCount: number; hasDataRoomAccess: boolean;
  viaGrant: boolean; viaDecision: boolean; isArchived: boolean;
  // Prompt 319 — already masked server-side (shapeFollowOnPayload); never
  // carries the signaling investor's identity when visibility is 'anonymous'.
  followOnSignals?: import('@/lib/network').FollowOnPayload[];
}
export interface Overview {
  org_name: string | null; one_liner: string | null; description: string | null;
  country: string | null; hq_city: string | null; sectors: string[] | null;
  founded_year: number | null; round_target_eur: number | null; revenue_eur: number | null; stage: string | null;
  tam_eur: number | null; sam_eur: number | null; som_eur: number | null;
  revenue_projection_12mo_eur: number | null; revenue_projection_5yr_eur: number | null;
  traction_metrics: Record<string, unknown> | null;
  founders: { full_name: string; title: string | null; bio: string | null; photo_url: string | null }[] | null;
  team_summary: string | null; representative_name: string | null; representative_linkedin: string | null;
}
export interface TeamMember { id: string; fullName: string; title: string | null; isFounder: boolean; linkedinUrl: string | null; email?: string }
export interface ContactHistoryItem { id: string; at: string; content: string; channel: string | null }
export interface DocumentTitle { id: string; name: string }
// P136 — the disclosure ladder's own response shape. Keys are ABSENT (not
// null/empty) below the level that unlocks them — server-enforced in
// /api/portal/startup/[orgId] (and, identically, /api/settings/dossier-preview)
// via projectDossier, never a client-side hide.
export interface Dossier {
  overview?: Overview; tractionDetailed?: Record<string, unknown>; team?: TeamMember[];
  contactHistory?: ContactHistoryItem[]; documentTitles?: DocumentTitle[];
  canMessageNamedPerson?: boolean; canRequestDataRoom?: boolean;
  swot?: SwotData;
  founderClarifications?: { category: ReviewCategory; text: string }[];
  roadmap?: { period_kind: RoadmapPeriodKind; period_year: number; period_quarter?: number; items: string[]; items_v2?: { text: string; category_id: string | null }[] }[];
  roadmapCategories?: { id: string; label: string; color: string; shape: string }[];
}

export const CLARIFICATION_CAPTION: Record<ReviewCategory, string> = {
  strengths: 'Re: a strength', weaknesses: 'Re: a weakness', opportunities: 'Re: an opportunity',
  threats: 'Re: a threat', risks: 'Re: a risk', recommendations: 'Re: a recommendation',
};

export function fmtEur(n: number | null | undefined) {
  return n == null ? null : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
}

// P136 — reads exclusively from `dossier`, whose keys are ABSENT below the
// level that unlocks them (never present-but-hidden). "Not shared yet" for
// the About block falls back to card.oneLiner — that field is already
// Discovery-visible on the compact Pipeline row (P134-A) for the real
// investor caller; the preview caller (Prompt 306) fills the same field
// straight from the founder's own org, since it's their own data.
//
// `onRequestLevel`/`levelBusy` are optional and `readOnly` defaults false —
// the real investor page passes all three; the founder preview passes
// none, so no button that would call requestLevel ever renders (Prompt
// 306's own guard: "no action that implies a real investor relationship").
// `scorecardOrgId` is likewise optional — ONLY the real investor page
// passes it, since ScorecardPanel is the INVESTOR's own private scoring of
// this startup, not something the startup itself has any content for.
export function DossierOverviewSections({
  card, level, dossier, onRequestLevel, levelBusy, readOnly, scorecardOrgId, swotOffHref, roadmapOffHref,
}: {
  card: Card; level: 0 | 1 | 2 | 3; dossier: Dossier;
  onRequestLevel?: (level: 2 | 3) => void; levelBusy?: boolean;
  readOnly?: boolean; scorecardOrgId?: string;
  // Preview-only (Prompt 306): set ONLY when level >= 1 AND the section is
  // absent because the founder's OWN toggle is off, never when it's simply
  // not unlocked at this level yet — the caller (the preview page) is the
  // one place that knows which of the two explains an absence, since the
  // real investor-facing route never returns that distinction (an investor
  // is never shown WHY a section is missing, only that it is). When set,
  // renders a greyed "off, here's the switch" section in place of silent
  // omission (Pedido 3) — the real investor page never passes these.
  swotOffHref?: string; roadmapOffHref?: string;
}) {
  const overview = dossier.overview;
  const hasMarket = overview && (overview.tam_eur != null || overview.sam_eur != null || overview.som_eur != null);
  const team = dossier.team ?? [];
  const hasTeam = team.length > 0 || (overview && (overview.team_summary || overview.representative_name));
  const traction = dossier.tractionDetailed && Object.keys(dossier.tractionDetailed).length > 0
    ? Object.entries(dossier.tractionDetailed) : [];

  return (
    <div id="dossier-overview" className="space-y-4">
      {/* Prompt 213 §B — le-se como abas, comporta-se como ancoras: clicar
          salta a seccao, o scroll destaca a activa, e o dossier continua a
          poder ser percorrido (ou impresso) de uma ponta a outra. */}
      <SectionNav containerId="dossier-overview" />
      <div id="about" data-section="About" className="scroll-mt-16 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">About</h2>
        {/* §A — a pagina e larga, o paragrafo nao: texto corrido acima de
            ~75 caracteres por linha perde-se a mudar de linha. */}
        <p className="mt-1 max-w-prose text-sm text-gray-700">{overview?.description || card.oneLiner || 'Not shared yet.'}</p>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-400">
          {card.sectors.length > 0 && <span>{card.sectors.join(', ')}</span>}
          {overview?.founded_year && <span>Founded {overview.founded_year}</span>}
          {(overview?.hq_city || overview?.country) && <span>{[overview?.hq_city, overview?.country].filter(Boolean).join(', ')}</span>}
        </div>
      </div>

      {/* Prompt 166 §D.4 — right after the About/summary block, before the
          round's financial details: a quick strategic read comes before the
          numbers. Server-gated (dossier.swot is absent unless both the
          level and the founder's toggle allow it) — no "hidden" message
          when it's off, consistent with every other gated section here. */}
      {dossier.swot ? (
        <div id="swot" data-section="SWOT" className="scroll-mt-16 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-[#0E7490]">SWOT snapshot</h2>
          <div className="mt-2"><SwotQuadrant data={dossier.swot} /></div>
        </div>
      ) : swotOffHref && level >= 1 ? (
        <div id="swot" data-section="SWOT" className="scroll-mt-16 rounded-lg border border-dashed border-gray-200 bg-gray-50 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-400">SWOT snapshot</h2>
            <Link href={swotOffHref} className="shrink-0 text-xs font-medium text-[#0E7490] hover:underline">Turn on →</Link>
          </div>
          <p className="mt-1 text-xs text-gray-400">Off — investors in contact with you won&apos;t see this until you turn it on.</p>
        </div>
      ) : null}

      {/* Prompt 167 §C.4 — same positioning logic as SWOT above: a quick
          summary belongs near the top, before the round's financial
          details. dossier.roadmap is present (possibly an empty array) once
          level + the founder's toggle both allow it — RoadmapTimeline
          itself handles zero milestones by showing just the founding node,
          same as it does founder-side in RoadmapCard.tsx. editable={false}
          and no callbacks: no "+", no edit/remove hover-actions here. */}
      {dossier.roadmap ? (
        <div id="roadmap" data-section="Roadmap" className="scroll-mt-16 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">Roadmap</h2>
          <div className="mt-2">
            {/* Prompt 213 §C — ajusta a largura (piso 11px); acima disso a
                lupa por ano. O slider deixou de ser o mecanismo primario. */}
            <ResponsiveRoadmap foundedYear={overview?.founded_year ?? null} milestones={dossier.roadmap} categories={dossier.roadmapCategories ?? []} />
          </div>
        </div>
      ) : roadmapOffHref && level >= 1 ? (
        <div id="roadmap" data-section="Roadmap" className="scroll-mt-16 rounded-lg border border-dashed border-gray-200 bg-gray-50 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-400">Roadmap</h2>
            <Link href={roadmapOffHref} className="shrink-0 text-xs font-medium text-[#0E7490] hover:underline">Turn on →</Link>
          </div>
          <p className="mt-1 text-xs text-gray-400">Off — investors in contact with you won&apos;t see this until you turn it on.</p>
        </div>
      ) : null}

      {/* Prompt 168 §D — server-gated absence: this key only exists at all
          when N > 0 (projectDossier's own rule), so there's no "0
          clarifications" state to render here — the section simply isn't
          there, same as the rest of this page's disclosure-ladder sections. */}
      {dossier.founderClarifications && dossier.founderClarifications.length > 0 && (
        <div id="clarifications" data-section="Clarifications" className="scroll-mt-16 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">Founder clarifications</h2>
          <p className="mt-1 text-xs text-gray-500">
            The founder added {dossier.founderClarifications.length} clarification{dossier.founderClarifications.length === 1 ? '' : 's'} to their review.
          </p>
          <ul className="mt-2 space-y-2">
            {dossier.founderClarifications.map((c, i) => (
              <li key={i} className="rounded-lg border border-gray-100 bg-gray-50 p-2.5 text-sm">
                <div className="text-xs font-medium text-gray-400">{CLARIFICATION_CAPTION[c.category]}</div>
                <p className="mt-0.5 text-gray-700">{c.text}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(card.roundTargetEur != null || card.roundValuationEur != null || card.roundMinTicketEur != null || card.roundInstruments.length > 0) && (
        <div id="round" data-section="Round" className="scroll-mt-16 rounded-lg border border-gray-200 bg-white p-4">
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
        <div id="market" data-section="Market" className="scroll-mt-16 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">Market</h2>
          <dl className="mt-2 grid grid-cols-3 gap-x-4 gap-y-2 text-sm">
            {overview!.tam_eur != null && <div><dt className="text-xs text-gray-400">TAM</dt><dd>{fmtEur(overview!.tam_eur)}</dd></div>}
            {overview!.sam_eur != null && <div><dt className="text-xs text-gray-400">SAM</dt><dd>{fmtEur(overview!.sam_eur)}</dd></div>}
            {overview!.som_eur != null && <div><dt className="text-xs text-gray-400">SOM</dt><dd>{fmtEur(overview!.som_eur)}</dd></div>}
          </dl>
        </div>
      )}

      {scorecardOrgId && <ScorecardPanel orgId={scorecardOrgId} />}

      {level >= 2 ? (
        <>
          {hasTeam && (
            <div id="team" data-section="Team" className="scroll-mt-16 rounded-lg border border-gray-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-gray-900">Team</h2>
              {overview?.team_summary && <p className="mt-1 text-sm text-gray-700">{overview.team_summary}</p>}
              {team.length > 0 ? (
                <ul className="mt-2 space-y-1.5">
                  {team.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-gray-700">
                        {p.fullName}{p.title && <span className="text-gray-400"> — {p.title}</span>}
                        {p.isFounder && <span className="ml-1.5 rounded-full bg-[#E8F4F8] px-1.5 py-0.5 text-[10px] font-semibold text-[#0E7490]">Founder</span>}
                        {p.email && <span className="ml-1.5 text-gray-400">· {p.email}</span>}
                      </span>
                      {p.linkedinUrl && (
                        <a href={p.linkedinUrl} target="_blank" rel="noreferrer" className="shrink-0 text-[#0E7490] hover:underline">LinkedIn</a>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <>
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
                </>
              )}
              {!readOnly && !dossier.canMessageNamedPerson && team.length > 0 && (
                <button onClick={() => onRequestLevel?.(3)} disabled={levelBusy}
                  className="mt-2 text-xs text-[#0E7490] hover:underline disabled:opacity-40">
                  Request contact →
                </button>
              )}
            </div>
          )}

          {traction.length > 0 && (
            <div id="traction" data-section="Traction" className="scroll-mt-16 rounded-lg border border-gray-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-gray-900">Traction</h2>
              <div className="mt-2 flex flex-wrap gap-4">
                {traction.map(([label, value]) => (
                  <div key={label}><div className="text-xs text-gray-400">{label}</div><div className="text-sm font-semibold text-gray-900">{String(value)}</div></div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : level === 1 ? (
        <div className="rounded-lg border border-dashed border-gray-200 bg-white p-4 text-center">
          <p className="text-sm text-gray-600">
            {readOnly
              ? 'At this level, an investor would need to request the full profile to see the team, detailed traction, document titles, and contact history.'
              : 'Request the full profile to see the team, detailed traction, document titles, and contact history.'}
          </p>
          {!readOnly && (
            <button onClick={() => onRequestLevel?.(2)} disabled={levelBusy}
              className="mt-2 rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
              Request full profile
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
