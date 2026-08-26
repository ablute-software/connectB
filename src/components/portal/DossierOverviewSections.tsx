'use client';
// Prompt 306 — extracted out of /portal/startup/[orgId]/page.tsx's own
// OverviewTab so the founder-only "see how investors see this profile"
// preview can render the EXACT SAME markup an investor sees, not a
// reconstruction that could quietly drift from it. Every type/const the
// section markup depends on moved here too, so there is exactly one
// definition of "what this looks like" for both callers.
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { SwotQuadrant } from '@/components/readiness/SwotVisualCard';
import { RoadmapCanvas } from '@/components/company/RoadmapCanvas';
import { RoadmapEventDetailPanel } from '@/components/company/RoadmapEventDetailPanel';
import { GLASS_CARD } from '@/components/company/roadmap-visual';
import { roadmapFont } from '@/lib/fonts';
import type { SwotData } from '@/lib/types';
import type { ReviewCategory } from '@/lib/review-clarifications';
import { shouldShowMiniPitchTeaser } from '@/lib/mini-pitch';
import { resolveInitialTabFromHash } from '@/lib/dossier-tabs';
import { isTeamSummaryRedundant } from '@/lib/team-summary';
import { MediaGallery, type GalleryItem } from './MediaGallery';
import { MiniPitchDeck } from '@/components/mini-pitch/MiniPitchSlideView';

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
export interface TeamMember {
  id: string; fullName: string; title: string | null; isFounder: boolean; linkedinUrl: string | null; email?: string;
  // Prompt 388 §A — already exist and already filled in by founders
  // (StartupTeamCard.tsx); the investor-facing query just never asked.
  bio?: string | null; photoUrl?: string | null;
}
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
  // Prompt 388 §D.1 — when review_runs last regenerated this snapshot; a
  // SWOT with no `swot` key at all skips this too, same server gate.
  swotGeneratedAt?: string | null;
  founderClarifications?: { category: ReviewCategory; text: string }[];
  // Prompt 359 Block E — one row per roadmap_events event (never the legacy
  // per-period milestones shape). document_id is present only when this
  // investor is also at documentTitles' own disclosure tier (level >= 2) —
  // see dossier-fetch.ts's own comment on why that's the right gate to reuse
  // rather than a new one.
  roadmap?: { id: string; title: string; description?: string; date: string; end_date?: string; status: 'done' | 'planned'; category_id?: string; document_id?: string }[];
  roadmapCategories?: { id: string; label: string; color: string; shape: string }[];
  // Prompt 326 — already fully masked (projectBadgesForInvestor): disputed
  // badges and internal fields (verification_note, evidence_document_id)
  // never reach this shape at all.
  badges?: { id: string; name: string; description: string | null; year: number | null; verificationStatus: 'unverified' | 'verified' }[];
  // Prompt 334 — already stripped of claim ids and the internal evidence-
  // class taxonomy (projectMiniPitchForInvestor); absent unless the founder
  // has both reached level 1 AND actually activated a mini-pitch.
  // Prompt 379 §D — imageUrl/imageCaption are RESOLVED server-side
  // (dossier-fetch.ts) from the slide's media id; the id itself never
  // reaches the client.
  miniPitch?: { kind: 'hook' | 'whyNow' | 'proof' | 'team' | 'ask'; title?: string; body: string; imageUrl?: string | null; imageCaption?: string | null }[];
  // Prompt 353 — company photos & videos, already split by category and
  // level-gated server-side (projectDossier): aboutMedia covers both
  // Company (brand/office/product-in-context) and Technology/IP items,
  // teamMedia is absent below level 2 (same gate the Team section itself
  // has). Never present on the compact Pipeline card — this dossier-only
  // shape has no equivalent there.
  aboutMedia?: { id: string; category: 'company' | 'technology'; caption: string; kind: 'image' | 'video_upload' | 'video_link'; url: string }[];
  teamMedia?: { id: string; category: 'team'; caption: string; kind: 'image' | 'video_upload' | 'video_link'; url: string }[];
}

// Prompt 334 — a small horizontal slide navigator. Deliberately no autoplay:
// an investor reads at their own pace, and autoplay would fight anyone using
// the dots to go back and re-read one slide.
//
// Prompt 379 §B — the markup moved verbatim into the SHARED
// MiniPitchDeck (components/mini-pitch/MiniPitchSlideView.tsx) so the
// founder's own MatchDeal preview renders the exact same component instead
// of a second copy that drifts. Nothing about what the investor sees
// changed; this is now a thin adapter.
function MiniPitchSlides({ slides }: { slides: NonNullable<Dossier['miniPitch']> }) {
  return <MiniPitchDeck slides={slides} />;
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
// Prompt 356 §A — ScorecardPanel used to ALSO render inline here (a
// `scorecardOrgId` prop), duplicating the Track & Evaluate sidebar's own
// copy (347/352) on every single sub-tab. One scorecard, one home: the
// T&E left column when the mode is on, never here — removed outright
// rather than conditionally hidden, so there's exactly one source of truth
// (the mode) for whether it renders at all.
export function DossierOverviewSections({
  card, level, dossier, onRequestLevel, levelBusy, readOnly, swotOffHref, roadmapOffHref,
}: {
  card: Card; level: 0 | 1 | 2 | 3; dossier: Dossier;
  onRequestLevel?: (level: 2 | 3) => void; levelBusy?: boolean;
  readOnly?: boolean;
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
  // Prompt 385 §B — selection is lifted (RoadmapCanvas's own contract), so
  // the detail panel can render beside Categories... except the investor
  // dossier has no Categories card (never editable here), so the panel just
  // sits below the canvas on its own, full width.
  const [selectedRoadmapId, setSelectedRoadmapId] = useState<string | null>(null);
  const overview = dossier.overview;
  const hasMarket = overview && (overview.tam_eur != null || overview.sam_eur != null || overview.som_eur != null);
  const team = dossier.team ?? [];
  const hasTeam = team.length > 0 || (overview && (overview.team_summary || overview.representative_name));
  const traction = dossier.tractionDetailed && Object.keys(dossier.tractionDetailed).length > 0
    ? Object.entries(dossier.tractionDetailed) : [];
  // Prompt 353 — placement decision, documented: Technology/IP media gets
  // its own labeled "Product & technology" block within the About tab
  // (never a separate top-level pill — the Overview doesn't have a
  // technology SECTION of its own, just this sub-block), Company media
  // sits directly under the About text with no extra heading.
  const companyMedia: GalleryItem[] = (dossier.aboutMedia ?? []).filter((m) => m.category === 'company');
  const technologyMedia: GalleryItem[] = (dossier.aboutMedia ?? []).filter((m) => m.category === 'technology');
  const teamMedia: GalleryItem[] = dossier.teamMedia ?? [];

  // Prompt 351 — real tabs instead of anchors-with-scroll. Sections are
  // built here, in order, by the exact same conditions the old vertical
  // stack used — a single source of truth for "what exists," never a
  // second list that could drift (same reasoning the old SectionNav's own
  // comment gave for discovering sections in the DOM instead of a parallel
  // array; this replaces DOM-discovery with array-building for the same
  // reason: exactly one place decides what's there).
  const sections: { id: string; label: string; node: ReactNode }[] = [];

  sections.push({
    id: 'about', label: 'About',
    node: (
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
            here for that state.
            Prompt 357 §C2 — given its own discrete labeled block (icon +
            name + verified state) instead of sitting inline as unlabeled
            pills, same "bloco discreto e bonito" ask; read-only, no edit
            affordance, no internal state (verification_note/disputed) ever
            reaches this far — projectBadgesForInvestor already stripped it. */}
        {dossier.badges && dossier.badges.length > 0 && (
          <div className="mt-3 border-t border-gray-100 pt-3">
            <h3 className="text-xs font-semibold text-gray-500">Badges &amp; awards</h3>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {dossier.badges.map((b) => (
                <span key={b.id}
                  title={b.verificationStatus === 'verified' ? 'Verified' : 'Not yet verified'}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                    b.verificationStatus === 'verified'
                      ? 'border-cyan-200 bg-cyan-50 text-[#0E7490]'
                      : 'border-gray-200 bg-gray-50 text-gray-400 opacity-60 grayscale'
                  }`}>
                  🏅 {b.name}{b.year ? ` (${b.year})` : ''}{b.verificationStatus === 'verified' && <span aria-hidden>✓</span>}
                </span>
              ))}
            </div>
          </div>
        )}
        <MediaGallery items={companyMedia} />
        {technologyMedia.length > 0 && (
          <div className="mt-3 border-t border-gray-100 pt-3">
            <h3 className="text-xs font-semibold text-gray-500">Product & technology</h3>
            <MediaGallery items={technologyMedia} />
          </div>
        )}
      </div>
    ),
  });

  // Prompt 334 — the mini-pitch, right after About: the concrete "here's
  // the case" an investor at Level 1 sees, before SWOT/roadmap/round
  // detail. Absent entirely unless the founder both reached this level
  // AND activated a mini-pitch (dossier.miniPitch is server-gated on
  // both, dossier-fetch.ts) — no placeholder, no "not activated yet"
  // message shown to an investor (that message belongs to the founder's
  // own settings page, never here).
  if (dossier.miniPitch && dossier.miniPitch.length > 0) {
    sections.push({ id: 'mini-pitch', label: 'Pitch', node: <MiniPitchSlides slides={dossier.miniPitch} /> });
  }

  // Prompt 166 §D.4 — right after the About/summary block, before the
  // round's financial details: a quick strategic read comes before the
  // numbers. Server-gated (dossier.swot is absent unless both the level
  // and the founder's toggle allow it) — no "hidden" message when it's
  // off, consistent with every other gated section here.
  if (dossier.swot) {
    sections.push({
      id: 'swot', label: 'SWOT',
      node: (
        <div id="swot" data-section="SWOT" className="scroll-mt-16 rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[#0E7490]">SWOT snapshot</h2>
            {/* Prompt 388 §D.1 — a photo, not a live view: this only
                regenerates when the founder clicks "Run analysis" (quota-
                limited), so reading it as stale-and-broken instead of
                dated-and-correct was the actual bug. */}
            {dossier.swotGeneratedAt && (
              <span className="text-[11px] text-gray-400" title="This is a snapshot — it updates only when the founder re-runs their analysis.">
                Last updated: {new Date(dossier.swotGeneratedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            )}
          </div>
          <div className="mt-2"><SwotQuadrant data={dossier.swot} /></div>
        </div>
      ),
    });
  } else if (swotOffHref && level >= 1) {
    sections.push({
      id: 'swot', label: 'SWOT',
      node: (
        <div id="swot" data-section="SWOT" className="scroll-mt-16 rounded-lg border border-dashed border-gray-200 bg-gray-50 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-400">SWOT snapshot</h2>
            <Link href={swotOffHref} className="shrink-0 text-xs font-medium text-[#0E7490] hover:underline">Turn on →</Link>
          </div>
          <p className="mt-1 text-xs text-gray-400">Off — investors in contact with you won&apos;t see this until you turn it on.</p>
        </div>
      ),
    });
  }

  // Prompt 167 §C.4 — same positioning logic as SWOT above: a quick
  // summary belongs near the top, before the round's financial details.
  // dossier.roadmap is present (possibly an empty array) once level + the
  // founder's toggle both allow it. Prompt 359 Block E — renders the SAME
  // RoadmapCanvas the founder edits, editable={false} and no callbacks: no
  // click-to-create, no drag, no "+", one component for both sides so they
  // can never visually diverge. An evidence chip's document_id is only ever
  // present in the payload when this investor is ALSO at documentTitles'
  // own level (dossier-fetch.ts's own gate) — resolveDocChip just looks the
  // name up in the SAME documentTitles list already fetched for that tier,
  // never a second disclosure decision made client-side.
  if (dossier.roadmap) {
    const docNameById = new Map((dossier.documentTitles ?? []).map((d) => [d.id, d.name]));
    const resolveDocChip = (documentId: string) => {
      const name = docNameById.get(documentId);
      return name ? { name, visible: true } : null;
    };
    const selectedRoadmapEvent = selectedRoadmapId ? dossier.roadmap.find((e) => e.id === selectedRoadmapId) ?? null : null;
    sections.push({
      id: 'roadmap', label: 'Roadmap',
      node: (
        <div id="roadmap" data-section="Roadmap" className={`${roadmapFont.className} scroll-mt-16 space-y-4`}>
          <div className={`${GLASS_CARD} p-5`}>
            <h2 className="mb-3 text-[15px] font-semibold text-[#131b2e]">Roadmap</h2>
            <RoadmapCanvas
              events={dossier.roadmap}
              categories={dossier.roadmapCategories ?? []}
              foundedYear={overview?.founded_year ?? null}
              editable={false}
              selectedId={selectedRoadmapId}
              onSelect={setSelectedRoadmapId}
            />
          </div>
          {dossier.roadmap.length > 0 && (
            <RoadmapEventDetailPanel
              event={selectedRoadmapEvent}
              categories={dossier.roadmapCategories ?? []}
              editable={false}
              resolveDocChip={resolveDocChip}
            />
          )}
        </div>
      ),
    });
  } else if (roadmapOffHref && level >= 1) {
    sections.push({
      id: 'roadmap', label: 'Roadmap',
      node: (
        <div id="roadmap" data-section="Roadmap" className="scroll-mt-16 rounded-lg border border-dashed border-gray-200 bg-gray-50 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-400">Roadmap</h2>
            <Link href={roadmapOffHref} className="shrink-0 text-xs font-medium text-[#0E7490] hover:underline">Turn on →</Link>
          </div>
          <p className="mt-1 text-xs text-gray-400">Off — investors in contact with you won&apos;t see this until you turn it on.</p>
        </div>
      ),
    });
  }

  // Prompt 168 §D — server-gated absence: this key only exists at all
  // when N > 0 (projectDossier's own rule), so there's no "0
  // clarifications" state to render here — the section simply isn't
  // there, same as the rest of this page's disclosure-ladder sections.
  if (dossier.founderClarifications && dossier.founderClarifications.length > 0) {
    sections.push({
      id: 'clarifications', label: 'Clarifications',
      node: (
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
      ),
    });
  }

  if (card.roundTargetEur != null || card.roundValuationEur != null || card.roundMinTicketEur != null || card.roundInstruments.length > 0) {
    sections.push({
      id: 'round', label: 'Round',
      node: (
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
      ),
    });
  }

  if (hasMarket) {
    sections.push({
      id: 'market', label: 'Market',
      node: (
        <div id="market" data-section="Market" className="scroll-mt-16 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">Market</h2>
          <dl className="mt-2 grid grid-cols-3 gap-x-4 gap-y-2 text-sm">
            {overview!.tam_eur != null && <div><dt className="text-xs text-gray-400">TAM</dt><dd>{fmtEur(overview!.tam_eur)}</dd></div>}
            {overview!.sam_eur != null && <div><dt className="text-xs text-gray-400">SAM</dt><dd>{fmtEur(overview!.sam_eur)}</dd></div>}
            {overview!.som_eur != null && <div><dt className="text-xs text-gray-400">SOM</dt><dd>{fmtEur(overview!.som_eur)}</dd></div>}
          </dl>
        </div>
      ),
    });
  }

  if (level >= 2 && hasTeam) {
    sections.push({
      id: 'team', label: 'Team',
      node: (
        <div id="team" data-section="Team" className="scroll-mt-16 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">Team</h2>
          {/* Prompt 357 §A — confirmed bug: team_summary sometimes holds
              literally "Name — Title" for one of the members listed right
              below, showing that same person twice. (1) Its own identity
              here — a labeled intro block, never rendered like a member
              row. (2) Suppressed outright when it's trivially redundant
              with a listed member's own name+title (isTeamSummaryRedundant,
              pure/tested) — a real summary sentence is never affected. */}
          {overview?.team_summary && !isTeamSummaryRedundant(overview.team_summary, team) && (
            <div className="mt-1 rounded-lg bg-gray-50 px-2.5 py-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Team overview</p>
              <p className="mt-0.5 text-sm text-gray-700">{overview.team_summary}</p>
            </div>
          )}
          {team.length > 0 ? (
            <ul className="mt-2 space-y-2.5">
              {team.map((p) => (
                <li key={p.id} className="flex items-start gap-2.5 text-xs">
                  {/* Prompt 388 §A — round avatar, initials fallback when
                      photoUrl is empty (never an empty/broken image box). */}
                  {p.photoUrl ? (
                    <img src={p.photoUrl} alt="" className="mt-0.5 h-8 w-8 shrink-0 rounded-full object-cover" />
                  ) : (
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#E8F4F8] text-[10px] font-semibold text-[#0E7490]">
                      {p.fullName.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-gray-700">
                        {p.fullName}{p.title && <span className="text-gray-400"> — {p.title}</span>}
                        {p.isFounder && <span className="ml-1.5 rounded-full bg-[#E8F4F8] px-1.5 py-0.5 text-[10px] font-semibold text-[#0E7490]">Founder</span>}
                        {p.email && <span className="ml-1.5 text-gray-400">· {p.email}</span>}
                      </span>
                      {p.linkedinUrl && (
                        <a href={p.linkedinUrl} target="_blank" rel="noreferrer" className="shrink-0 text-[#0E7490] hover:underline">LinkedIn</a>
                      )}
                    </div>
                    {p.bio && <p className="mt-0.5 text-gray-500">{p.bio}</p>}
                  </div>
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
          <MediaGallery items={teamMedia} />
        </div>
      ),
    });
  }

  if (level >= 2 && traction.length > 0) {
    sections.push({
      id: 'traction', label: 'Traction',
      node: (
        <div id="traction" data-section="Traction" className="scroll-mt-16 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">Traction</h2>
          <div className="mt-2 flex flex-wrap gap-4">
            {traction.map(([label, value]) => (
              <div key={label}><div className="text-xs text-gray-400">{label}</div><div className="text-sm font-semibold text-gray-900">{String(value)}</div></div>
            ))}
          </div>
        </div>
      ),
    });
  }

  const sectionIds = sections.map((s) => s.id);
  const [activeId, setActiveId] = useState('about');

  // Prompt 351 — deep-links: opening with #round selects the Round tab.
  // Read once on mount only — a later change to the URL hash from outside
  // this component (there isn't one today) is deliberately not tracked,
  // same scope as the old SectionNav's own scroll-spy only ever ran client-side.
  useEffect(() => {
    setActiveId(resolveInitialTabFromHash(window.location.hash, sectionIds, 'about'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectTab(id: string) {
    setActiveId(id);
    // replaceState, never pushState — switching tabs must not grow browser
    // history (Prompt 351's own requirement: "sem entradas de histórico por clique").
    window.history.replaceState(null, '', `#${id}`);
  }

  const active = sections.find((s) => s.id === activeId) ?? sections[0];

  return (
    <div id="dossier-overview" className="space-y-4">
      {/* Prompt 351 — real tabs: clicking a pill shows ONLY that section's
          content, immediately below the pill row — no other sections above
          or below, no scroll-down. Replaces the old anchor-scroll SectionNav
          (which discovered sections via [data-section] DOM query + an
          IntersectionObserver scroll-spy); a single pill row disappears
          when there's only one section, same as before.
          Prompt 352 §A — deliberately NOT sticky: it used to be `sticky
          top-0 z-20`, which outranked every other sticky header in the app
          (the established convention everywhere else is z-10 — confirmed by
          grep) and, since the dossier page's own header is ALSO sticky at
          top-0 with a height that varies by state (passed/interested/
          confirming), no fixed top offset could reliably clear it — the
          two would overlap and this nav's higher z-index painted it over
          the page header while scrolling. With 351 showing only one
          section's content at a time, each tab's content is short enough
          that this bar being always-visible isn't worth reintroducing that
          risk for. */}
      {sections.length > 1 && (
        <nav className="-mx-1 mb-3 flex gap-1 overflow-x-auto border-b border-gray-200 bg-[#F7F9FA]/95 px-1 py-2">
          {sections.map((s) => (
            <button key={s.id} onClick={() => selectTab(s.id)}
              className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                activeId === s.id ? 'bg-[#0E7490] text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
              {s.label}
            </button>
          ))}
        </nav>
      )}

      {active?.node}

      {level === 1 && (
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
      )}
    </div>
  );
}
