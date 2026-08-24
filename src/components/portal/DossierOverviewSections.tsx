'use client';
// Prompt 306 — extracted out of /portal/startup/[orgId]/page.tsx's own
// OverviewTab so the founder-only "see how investors see this profile"
// preview can render the EXACT SAME markup an investor sees, not a
// reconstruction that could quietly drift from it. Every type/const the
// section markup depends on moved here too, so there is exactly one
// definition of "what this looks like" for both callers.
import { useState } from 'react';
import Link from 'next/link';
import { SectionNav } from '@/components/SectionNav';
import { ScorecardPanel } from '@/components/investor-workspace/ScorecardPanel';
import { SwotQuadrant } from '@/components/readiness/SwotVisualCard';
import { ResponsiveRoadmap } from '@/components/company/ResponsiveRoadmap';
import type { SwotData, RoadmapPeriodKind } from '@/lib/types';
import type { ReviewCategory } from '@/lib/review-clarifications';
import { shouldShowMiniPitchTeaser } from '@/lib/mini-pitch';

export interface Card {
  orgId: string; name: string; oneLiner: string | null; description: string | null;
  // Prompt 325 — additional to oneLiner, Discovery-visible, absent (not
  // empty string) when the founder hasn't filled it in.
  introProblem?: string; introSolution?: string;
  // Prompt 339 §B — existence only, never content: lets Level 0 show a
  // discreet "pitch available, express interest to unlock" signal without
  // revealing a single slide or even a slide count. Fail-closed: absent
  // (or false) means no mini-pitch was ever activated, and the block below
  // simply doesn't render — never a "not available yet" placeholder (that
  // would be exposing the founder's own gap, not the investor's).
  hasMiniPitch?: boolean;
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
  // Prompt 326 — already fully masked (projectBadgesForInvestor): disputed
  // badges and internal fields (verification_note, evidence_document_id)
  // never reach this shape at all.
  badges?: { id: string; name: string; description: string | null; year: number | null; verificationStatus: 'unverified' | 'verified' }[];
  // Prompt 334 — already stripped of claim ids and the internal evidence-
  // class taxonomy (projectMiniPitchForInvestor); absent unless the founder
  // has both reached level 1 AND actually activated a mini-pitch.
  miniPitch?: { kind: 'hook' | 'whyNow' | 'proof' | 'team' | 'ask'; title?: string; body: string }[];
}

const MINI_PITCH_SLIDE_LABEL: Record<'hook' | 'whyNow' | 'proof' | 'team' | 'ask', string> = {
  hook: 'Why us', whyNow: 'Why now', proof: 'Proof', team: 'Team', ask: 'The ask',
};

// Prompt 334 — a small horizontal slide navigator, local to this file since
// nothing else needs the shape yet. Deliberately no autoplay: an investor
// reads at their own pace, and autoplay would fight anyone using the dots
// to go back and re-read one slide.
function MiniPitchSlides({ slides }: { slides: NonNullable<Dossier['miniPitch']> }) {
  const [i, setI] = useState(0);
  const slide = slides[i];
  return (
    <div id="mini-pitch" data-section="Pitch" className="scroll-mt-16 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">{MINI_PITCH_SLIDE_LABEL[slide.kind]}</h2>
        <span className="shrink-0 text-[11px] text-gray-400">{i + 1} of {slides.length}</span>
      </div>
      {slide.title && <p className="mt-1 text-sm font-medium text-gray-700">{slide.title}</p>}
      <p className="mt-1 max-w-prose text-sm text-gray-700">{slide.body}</p>
      <div className="mt-3 flex items-center gap-3">
        <button onClick={() => setI((n) => Math.max(0, n - 1))} disabled={i === 0}
          className="text-xs font-medium text-[#0E7490] hover:underline disabled:cursor-not-allowed disabled:text-gray-300 disabled:no-underline">
          ← Back
        </button>
        <div className="flex gap-1">
          {slides.map((_, idx) => (
            <button key={idx} onClick={() => setI(idx)} aria-label={`Slide ${idx + 1}`}
              className={`h-1.5 w-1.5 rounded-full ${idx === i ? 'bg-[#0E7490]' : 'bg-gray-200'}`} />
          ))}
        </div>
        <button onClick={() => setI((n) => Math.min(slides.length - 1, n + 1))} disabled={i === slides.length - 1}
          className="text-xs font-medium text-[#0E7490] hover:underline disabled:cursor-not-allowed disabled:text-gray-300 disabled:no-underline">
          Next →
        </button>
      </div>
      <p className="mt-2 text-[10px] text-gray-400">Generated from company-provided data.</p>
    </div>
  );
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
        {/* Prompt 325 — the intro pitch, visible regardless of level (same
            tier as oneLiner above: Discovery-safe, founder-authored, never
            derived). Absent entirely when the founder hasn't filled it in,
            never an empty placeholder line. */}
        {(card.introProblem || card.introSolution) && (
          <div className="mt-2 max-w-prose space-y-0.5">
            {card.introProblem && <p className="text-sm text-gray-700"><span className="font-semibold text-gray-500">Problem: </span>{card.introProblem}</p>}
            {card.introSolution && <p className="text-sm text-gray-700"><span className="font-semibold text-gray-500">Solution: </span>{card.introSolution}</p>}
          </div>
        )}
        {/* Prompt 339 §B — signals a locked mini-pitch WITHOUT revealing it:
            only ever shown at Level 0 (once level >= 1, the real slides
            render below instead — MiniPitchSlides, never both at once) and
            only when the founder has actually activated one. Fail-closed:
            no mini-pitch at all means this block simply isn't here, never
            a "no pitch yet" placeholder that would expose the founder's own
            gap to the one audience it isn't theirs to show. */}
        {shouldShowMiniPitchTeaser(level, card.hasMiniPitch) && (
          <p className="mt-2 rounded-lg bg-[#E8F4F8] px-2.5 py-1.5 text-xs text-[#0E7490]">
            ✨ Pitch available — express interest to unlock the startup&apos;s pitch.
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-400">
          {card.sectors.length > 0 && <span>{card.sectors.join(', ')}</span>}
          {overview?.founded_year && <span>Founded {overview.founded_year}</span>}
          {(overview?.hq_city || overview?.country) && <span>{[overview?.hq_city, overview?.country].filter(Boolean).join(', ')}</span>}
        </div>
        {/* Prompt 326 Pedido E — verified (color) vs unverified (grayscale +
            reduced opacity) is the whole point: never hide an unverified
            claim, never invent confidence it hasn't earned. A disputed
            badge is already absent from this array entirely (server-side,
            projectBadgesForInvestor) — there is nothing to special-case
            here for that state. */}
        {dossier.badges && dossier.badges.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {dossier.badges.map((b) => (
              <span key={b.id}
                title={b.verificationStatus === 'verified' ? undefined : 'Not yet verified'}
                className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                  b.verificationStatus === 'verified'
                    ? 'border-cyan-200 bg-cyan-50 text-[#0E7490]'
                    : 'border-gray-200 bg-gray-50 text-gray-400 opacity-60 grayscale'
                }`}>
                {b.name}{b.year ? ` (${b.year})` : ''}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Prompt 334 — the mini-pitch, right after About: the concrete "here's
          the case" an investor at Level 1 sees, before SWOT/roadmap/round
          detail. Absent entirely unless the founder both reached this level
          AND activated a mini-pitch (dossier.miniPitch is server-gated on
          both, dossier-fetch.ts) — no placeholder, no "not activated yet"
          message shown to an investor (that message belongs to the founder's
          own settings page, never here). */}
      {dossier.miniPitch && dossier.miniPitch.length > 0 && <MiniPitchSlides slides={dossier.miniPitch} />}

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
