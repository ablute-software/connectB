'use client';
// MatchDeal PWA — the swipe deck.
//
// MD-08: the first version of this was functionally correct but visually
// indistinguishable from the founder CRM (same teal, same rounded-2xl
// cards, plain Pass/Like buttons), and it rendered *inside* the CRM Shell,
// so on a phone it read as "sherlockdeal.com badly scaled" rather than as
// a product of its own. The fix is two-part: /pair is now a standalone
// route (see shell.tsx), and this deck now has MatchDeal's own visual
// language — the blue/green/orange energy of the MatchDeal button in the
// app header, not the CRM's teal — plus real drag-to-swipe.
//
// Gestures are hand-rolled on pointer events rather than pulled from a
// library: the package.json here is deliberately small, and a swipe deck
// is ~60 lines of transform maths. Buttons stay as an equal-status path,
// not a fallback — they're what a keyboard or screen-reader user gets,
// and what works when this is projected rather than touched.
//
// Backend contract is unchanged: matchdeal_eligible_deck /
// matchdeal_record_exposure / matchdeal_record_swipe, all pre-existing
// RPCs called under RLS, none of their bodies touched.
// Prompt 147 §4 — one exception: matchdeal_profiles.hidden_fields
// (migration 0155) is a new column, but matchdeal_eligible_deck already
// `returns setof matchdeal_profiles` with no column projection, so it
// reaches this file's MatchDealProfile rows with zero RPC change.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browserClient } from '@/lib/supabase';
import { INSTRUMENT_LABELS, LEAD_OR_COLEAD_LABELS } from '@/lib/investor-taxonomy';
import { HypeListOverlay } from './HypeListOverlay';

export interface MatchDealProfile {
  id: string; kind: 'startup' | 'investor'; entity_name: string | null; photo_url: string | null;
  entity_logo_url: string | null; description: string | null; sectors: string[]; country: string | null;
  investment_stage_sought: string | null; stages_invested: string[]; founded_year: number | null;
  target_round_amount: number | null; team_summary: string | null; ticket_min: number | null; ticket_max: number | null;
  specific_criteria: string | null; representative_name: string | null; entity_type: string | null;
  // Prompt 110 — investor-slide fields. All already exist on
  // matchdeal_profiles and already reach the client in the RPC's payload
  // (matchdeal_eligible_deck is RETURNS SETOF matchdeal_profiles, no
  // column projection) — this is a TypeScript-only change, no backend
  // change ships with Block A.
  lead_or_colead: string | null;
  instruments: string[];
  capital_to_deploy_eur: number | null;
  investments_per_year: number | null;
  active_fund: string | null;
  portfolio_companies: string | null;
  recent_investments: string | null;
  usual_co_investors: string | null;
  geographies: string[];
  phases_accepted: string[];
  company_types: string[];
  exclusions_sectors: string[];
  exclusions_notes: string | null;
  focus_keywords: string[];
  website: string | null;
  created_at: string;
  // Prompt 110 Block D — new columns (migration 0107), also already
  // reaching the client payload with zero backend change.
  accepts_cold_contact: boolean | null;
  typical_decision_weeks: number | null;
  decision_process: string | null;
  does_follow_on: boolean | null;
  takes_board_seat: string | null;
  // Prompt 147 §4 — closed vocabulary enforced by migration 0155's CHECK
  // constraint; filtered client-side here (CardFace/StartupMiniPitch), not
  // at the matchdeal_eligible_deck RPC layer — a display preference, not a
  // hard privacy boundary (a determined technical investor calling the RPC
  // directly still sees the raw row). Flagged as a deliberate scope choice
  // in the Prompt 147 delivery report, not an oversight.
  hidden_fields: string[];
}

const STAGE_LABELS: Record<string, string> = {
  pre_seed: 'Pre-seed', seed: 'Seed', series_a: 'Series A', series_b_plus: 'Series B+', growth: 'Growth',
};

const ENTITY_TYPE_LABELS: Record<string, string> = {
  vc: 'VC fund', corporate_vc: 'Corporate VC', family_office: 'Family office',
  angel_network: 'Angel network', venture_studio: 'Venture studio', public_institutional: 'Public / institutional',
};

// Card art when a profile has no photo. Deterministic per name, so the
// same investor is always the same colour — a random gradient per render
// would flicker on every re-render mid-drag.
const GRADIENTS = [
  ['#2563EB', '#22D3EE'], ['#16A34A', '#84CC16'], ['#EA580C', '#F59E0B'],
  ['#7C3AED', '#EC4899'], ['#0891B2', '#34D399'], ['#DC2626', '#F97316'],
];

function hashString(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function initialsOf(name: string) {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function fmtEur(n: number | null) {
  if (n == null) return null;
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `€${(n / 1_000_000).toFixed(abs % 1_000_000 === 0 ? 0 : 1)}M`;
  if (abs >= 1_000) return `€${Math.round(n / 1_000)}k`;
  return `€${n}`;
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
      {children}
    </span>
  );
}

// Prompt 110 — the label/value pattern the investor slides 2-4 share,
// lifted out once instead of repeated inline. `warn` is the "Does not
// invest in" treatment (A.5) — never color-only, the label text itself
// still says what it is.
function Field({ label, children, warn }: { label: string; children: React.ReactNode; warn?: boolean }) {
  return (
    <div className={warn ? 'rounded-lg border border-red-400/30 bg-red-500/15 p-2' : undefined}>
      <p className={`text-[11px] font-semibold uppercase tracking-[0.1em] ${warn ? 'text-red-200/80' : 'text-white/60'}`}>{label}</p>
      <p className="text-[13px] leading-snug text-white/85">{children}</p>
    </div>
  );
}

// Prompt 81 Bloco 1 — stories-style sub-cards per profile, reached by
// swiping down (and back up). Startup-kind cards were rewritten by
// Prompt 98 into a fixed 4-slide mini-pitch (see StartupMiniPitch).
// Prompt 110 Block A.0 — investor-kind now also gets 4, up from the
// original 3, to match. Both counts are still CONSTANT per kind here —
// Block B's per-profile calculated count (skipping empty slides) is
// explicitly deferred until Prompt 109's gesture rewrite lands first, per
// Prompt 110's own ordering instruction (same lines, sequenced not
// parallel).
export function subCardCountFor(kind: 'startup' | 'investor') {
  return 4;
}

const TRACTION_LABELS: Record<string, string> = {
  mrr_arr: 'MRR / ARR', growth_rate: 'Growth rate', paying_customers: 'Paying customers / active users',
  lois_pilots: 'LOIs / pilots signed', waitlist: 'Waitlist', partnerships: 'Partnerships signed', other: 'Other',
};

export interface PitchFounder { full_name: string; title: string | null; bio: string | null; photo_url: string | null }
export interface PitchTractionMetric { type: string; value: string; label?: string }
export interface PitchData {
  org_name: string | null; one_liner: string | null; description: string | null;
  country: string | null; hq_city: string | null; sectors: string[];
  founded_year: number | null; round_target_eur: number | null; revenue_eur: number | null;
  logo_url: string | null; stage: string | null;
  tam_eur: number | null; sam_eur: number | null; som_eur: number | null;
  revenue_projection_12mo_eur: number | null; revenue_projection_5yr_eur: number | null;
  traction_metrics: PitchTractionMetric[];
  founders: PitchFounder[];
}

// Prompt 98 §5 — TAM→SAM→SOM, the classic funnel investors already know how
// to read (explicitly requested over inventing a new format). Per the
// dataviz skill: this is one magnitude narrowing, not 3 distinct identities,
// so color is sequential (one hue, light→dark) rather than 3 categorical
// hues. Band widths are fixed visual proportions, not a literal geometric
// scale of the real numbers — real values are read from the labels, which
// are always shown as text (never color-only).
function MarketFunnel({ tam, sam, som }: { tam: number; sam: number | null; som: number | null }) {
  const bands: { label: string; value: number; widthPct: number; fill: string }[] = [
    { label: 'TAM', value: tam, widthPct: 100, fill: '#93C5FD' },
  ];
  if (sam != null) bands.push({ label: 'SAM', value: sam, widthPct: 72, fill: '#3B82F6' });
  if (som != null) bands.push({ label: 'SOM', value: som, widthPct: 46, fill: '#1D4ED8' });

  return (
    <div className="mt-1.5 space-y-1.5">
      {bands.map((b) => (
        <div key={b.label} className="flex items-center gap-2">
          <div
            className="flex h-7 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white"
            style={{ width: `${b.widthPct}%`, backgroundColor: b.fill }}
          >
            {b.label}
          </div>
          <span className="truncate text-[11px] font-semibold text-white/85">{fmtEur(b.value)}</span>
        </div>
      ))}
    </div>
  );
}

// Prompt 98 — the 4-slide mini-pitch content for a startup card. pitchData
// comes from matchdeal_startup_pitch_data() (orgs + company_people + the
// matchdeal_profiles mini-pitch fields, joined server-side — RLS on orgs/
// company_people has no cross-org read path, so this can't be a direct
// client query). null while loading or for a profile with none yet.
function StartupMiniPitch({ i, pitchData, phaseChip, hiddenFields }: { i: number; pitchData: PitchData | null; phaseChip: string[]; hiddenFields: string[] }) {
  const [activeFounderIdx, setActiveFounderIdx] = useState<number | null>(null);

  if (!pitchData) {
    return <p className="mt-3 text-[13px] text-white/50">Loading pitch…</p>;
  }

  if (i === 0) {
    return (
      <>
        <p className="mt-2 text-[18px] font-bold leading-snug text-white">
          {pitchData.one_liner || "This startup hasn't written a one-liner yet."}
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(pitchData.hq_city || pitchData.country) && (
            <Chip>{pitchData.hq_city && pitchData.country ? `${pitchData.hq_city}, ${pitchData.country}` : (pitchData.hq_city ?? pitchData.country)}</Chip>
          )}
          {phaseChip.slice(0, 1).map((s) => <Chip key={s}>{s}</Chip>)}
          {fmtEur(pitchData.round_target_eur) && <Chip>{`Raising ${fmtEur(pitchData.round_target_eur)}`}</Chip>}
        </div>
        {pitchData.sectors.length > 0 && <p className="mt-2.5 truncate text-[11px] text-white/60">{pitchData.sectors.slice(0, 6).join(' · ')}</p>}
      </>
    );
  }

  if (i === 1) {
    const founders = pitchData.founders;
    if (founders.length === 0) return <p className="mt-3 text-[13px] text-white/50">No team members listed yet.</p>;
    const active = activeFounderIdx != null ? founders[activeFounderIdx] : null;
    return (
      <>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/60">Team</p>
        <div className="grid grid-cols-3 gap-2.5">
          {founders.slice(0, 6).map((f, idx) => {
            const [gf, gt] = GRADIENTS[hashString(f.full_name) % GRADIENTS.length];
            return (
              <button
                key={idx} type="button" onClick={() => setActiveFounderIdx(activeFounderIdx === idx ? null : idx)}
                className="flex flex-col items-center gap-1"
              >
                <span
                  className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full text-[13px] font-bold text-white"
                  style={f.photo_url ? undefined : { background: `linear-gradient(135deg, ${gf}, ${gt})` }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {f.photo_url ? <img src={f.photo_url} alt="" className="h-full w-full object-cover" /> : initialsOf(f.full_name)}
                </span>
                <span className="text-center text-[10px] font-medium leading-tight text-white/90">{f.full_name}</span>
                {f.title && <span className="text-center text-[9px] leading-tight text-white/55">{f.title}</span>}
              </button>
            );
          })}
        </div>
        {active && <p className="mt-2.5 text-[12px] leading-snug text-white/80">{active.bio || 'No bio yet.'}</p>}
      </>
    );
  }

  if (i === 2) {
    // Prompt 147 §4 — a hidden market_projections slide looks exactly like
    // an unfilled one (same fallback copy), deliberately: telegraphing
    // "this was hidden on purpose" reads worse to an investor than simply
    // not having it.
    if (hiddenFields.includes('market_projections') || pitchData.tam_eur == null) {
      return <p className="mt-3 text-[13px] text-white/50">Market size not reported yet.</p>;
    }
    return (
      <>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/60">Market</p>
        <MarketFunnel tam={pitchData.tam_eur} sam={pitchData.sam_eur} som={pitchData.som_eur} />
        {(pitchData.revenue_projection_12mo_eur != null || pitchData.revenue_projection_5yr_eur != null) && (
          <div className="mt-2.5 flex gap-4">
            {pitchData.revenue_projection_12mo_eur != null && (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-white/50">12mo revenue</p>
                <p className="text-[13px] font-semibold text-white/90">{fmtEur(pitchData.revenue_projection_12mo_eur)}</p>
              </div>
            )}
            {pitchData.revenue_projection_5yr_eur != null && (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-white/50">5yr revenue</p>
                <p className="text-[13px] font-semibold text-white/90">{fmtEur(pitchData.revenue_projection_5yr_eur)}</p>
              </div>
            )}
          </div>
        )}
        <p className="mt-2 text-[10px] italic text-white/45">Self-reported by the founder.</p>
      </>
    );
  }

  if (pitchData.traction_metrics.length === 0) return <p className="mt-3 text-[13px] text-white/50">No traction reported yet.</p>;
  return (
    <>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/60">Traction</p>
      <div className="space-y-2">
        {pitchData.traction_metrics.map((m, idx) => (
          <div key={idx}>
            <p className="text-[10px] uppercase tracking-wide text-white/50">{m.type === 'other' ? (m.label || 'Other') : (TRACTION_LABELS[m.type] ?? m.type)}</p>
            <p className="text-[15px] font-bold text-white">{m.value}</p>
          </div>
        ))}
      </div>
    </>
  );
}

// Prompt 110 Block C — the platform-activity band on the investor's Track
// record slide. The only content on the card an investor can't inflate:
// everything else is self-declared, this is measured by the product
// itself. RLS blocks a startup from reading another org's swipes/
// exposures/matches directly, so this reads matchdeal_investor_activity
// (a new SECURITY DEFINER RPC that returns only bucketed aggregates —
// never exact counts, dates, or identities; see the migration's own
// header for the non-negotiable design rules). Cached client-side per
// profile_id for the session, and fetched at most once per VISIBLE card
// (gated on `active`, not called for the backer/"next" card rendered
// behind it).
interface ActivitySummary {
  member_since: string | null;
  likes_ratio_bucket: string | null;
  replies_bucket: string | null;
  matches_bucket: string | null;
}
const activityCache = new Map<string, ActivitySummary | null>();
function useInvestorActivity(profileId: string | null): ActivitySummary | null | undefined {
  const [activity, setActivity] = useState<ActivitySummary | null | undefined>(
    profileId ? activityCache.get(profileId) : undefined,
  );
  useEffect(() => {
    if (!profileId) { setActivity(undefined); return; }
    if (activityCache.has(profileId)) { setActivity(activityCache.get(profileId)); return; }
    let cancelled = false;
    browserClient().rpc('matchdeal_investor_activity', { p_profile_id: profileId }).then(({ data, error }) => {
      if (cancelled) return;
      const row = (!error && data && data.length ? data[0] : null) as ActivitySummary | null;
      activityCache.set(profileId, row);
      setActivity(row);
    });
    return () => { cancelled = true; };
  }, [profileId]);
  return activity;
}

function memberSinceLabel(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}
const LIKES_RATIO_LABEL: Record<string, string> = { selective: 'Selective', balanced: 'Balanced', broad: 'Broad' };
const REPLIES_LABEL: Record<string, string> = { fast: 'Replies fast', within_days: 'Replies within days', slow: 'Slower to reply' };
const MATCHES_LABEL: Record<string, string> = { '1-5': '1–5 matches', '6-20': '6–20 matches', '20+': '20+ matches' };

function ActivityBand({ activity }: { activity: ActivitySummary | null | undefined }) {
  if (!activity) return null;
  const since = memberSinceLabel(activity.member_since);
  const parts = [
    since && `Member since ${since}`,
    activity.likes_ratio_bucket && LIKES_RATIO_LABEL[activity.likes_ratio_bucket],
    activity.replies_bucket && REPLIES_LABEL[activity.replies_bucket],
    activity.matches_bucket && MATCHES_LABEL[activity.matches_bucket],
  ].filter(Boolean) as string[];
  if (parts.length === 0) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/60">On the platform</p>
      <p className="text-[13px] leading-snug text-white/85">{parts.join(' · ')}</p>
    </div>
  );
}

export function CardFace({ p, subIndex, active, pitchData, slideDir }: { p: MatchDealProfile; subIndex?: number; active?: boolean; pitchData?: PitchData | null; slideDir?: 'up' | 'down' | null }) {
  const name = p.entity_name || (p.kind === 'startup' ? 'A startup' : 'An investor');
  const image = p.photo_url ?? p.entity_logo_url;
  const [from, to] = GRADIENTS[hashString(name) % GRADIENTS.length];
  // Prompt 147 §4 — hidden_fields only applies to investor-kind cards
  // (the 5-value vocabulary migration 0155 enforces has no startup-side
  // members besides market_projections, handled separately in
  // StartupMiniPitch below). A hidden field reads as simply absent, same
  // reasoning as the market_projections fallback.
  const hidden = p.hidden_fields ?? [];
  const stages = p.kind === 'startup'
    ? (p.investment_stage_sought ? [STAGE_LABELS[p.investment_stage_sought] ?? p.investment_stage_sought] : [])
    : hidden.includes('stages') ? [] : p.stages_invested.map((s) => STAGE_LABELS[s] ?? s);
  const geographies = p.kind === 'investor' && hidden.includes('geographies') ? [] : p.geographies;
  const specificCriteria = p.kind === 'investor' && hidden.includes('specific_criteria') ? null : p.specific_criteria;
  const money = p.kind === 'startup'
    ? (fmtEur(p.target_round_amount) ? `Raising ${fmtEur(p.target_round_amount)}` : null)
    : (hidden.includes('ticket') ? null : (fmtEur(p.ticket_min) || fmtEur(p.ticket_max) ? `Ticket ${fmtEur(p.ticket_min) ?? '—'}–${fmtEur(p.ticket_max) ?? '—'}` : null));
  const i = subIndex ?? 0;
  const cardCount = subCardCountFor(p.kind);
  const activity = useInvestorActivity(active && p.kind === 'investor' ? p.id : null);

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden rounded-[28px] shadow-[0_18px_50px_-12px_rgba(15,23,42,.45)]"
      style={{ background: `linear-gradient(150deg, ${from} 0%, ${to} 100%)` }}
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
      ) : (
        <div className="absolute inset-0 flex items-start justify-center pt-[14%]">
          <span className="select-none text-[92px] font-black leading-none text-white/25" style={{ letterSpacing: '-0.04em' }}>
            {initialsOf(name)}
          </span>
        </div>
      )}

      {active && (
        <div className="absolute inset-x-3 top-3 z-10 flex gap-1.5">
          {Array.from({ length: cardCount }, (_, s) => (
            <div key={s} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/30">
              <div className={`h-full rounded-full bg-white transition-all ${s <= i ? 'w-full' : 'w-0'}`} />
            </div>
          ))}
        </div>
      )}

      {/* Legibility scrim — the text below sits on top of either the photo
          or the gradient, and needs the same contrast floor in both cases. */}
      <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/85 via-black/45 to-transparent" />

      <div className="relative mt-auto p-5">
        {p.entity_type && ENTITY_TYPE_LABELS[p.entity_type] && (
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">
            {ENTITY_TYPE_LABELS[p.entity_type]}
          </div>
        )}
        <h2 className="text-[26px] font-extrabold leading-[1.1] text-white drop-shadow-sm">{name}</h2>
        {p.representative_name && (
          <p className="mt-1 text-[13px] font-medium text-white/80">{p.representative_name}</p>
        )}

        {/* Prompt 125 Block C — key={i} so React treats each sub-card as a
            fresh mount, which is what actually triggers the CSS entrance
            animation below (a plain class toggle on the same element
            wouldn't replay); slideDir picks which direction it enters
            from, matching whichever gesture/chevron moved subIndex. */}
        <div key={i} className={slideDir === 'up' ? 'matchdeal-subcard-enter-up' : slideDir === 'down' ? 'matchdeal-subcard-enter-down' : undefined}>
        {p.kind === 'investor' ? (
          <>
            {/* Slide 1 (i=0) — who they are. Unchanged from before Prompt 110:
                already the one slide that worked, not worth the risk of
                touching it (A.2). */}
            {i === 0 && p.description && (
              <p className="mt-2 line-clamp-3 text-[13px] leading-snug text-white/85">{p.description}</p>
            )}
            {i === 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {p.country && <Chip>{p.country}</Chip>}
                {stages.slice(0, 3).map((s) => <Chip key={s}>{s}</Chip>)}
                {money && <Chip>{money}</Chip>}
              </div>
            )}
            {i === 0 && p.sectors.length > 0 && (
              <p className="mt-2.5 truncate text-[11px] text-white/60">{p.sectors.slice(0, 6).join(' · ')}</p>
            )}

            {/* Slide 2 (i=1) — "The cheque" (A.3). The single question a
                founder asks before any other: is this money the right
                size, and in what form? */}
            {i === 1 && (() => {
              const min = hidden.includes('ticket') ? null : fmtEur(p.ticket_min);
              const max = hidden.includes('ticket') ? null : fmtEur(p.ticket_max);
              const ticket = min && max ? `${min}–${max}` : min ? `From ${min}` : max ? `Up to ${max}` : null;
              const instruments = p.instruments.map((v) => INSTRUMENT_LABELS[v] ?? v).join(' · ') || null;
              const role = p.lead_or_colead ? LEAD_OR_COLEAD_LABELS[p.lead_or_colead] ?? p.lead_or_colead : null;
              const deploy = fmtEur(p.capital_to_deploy_eur);
              const perYear = p.investments_per_year && p.investments_per_year > 0 ? String(p.investments_per_year) : null;
              const decisionTime = p.typical_decision_weeks && p.typical_decision_weeks > 0 ? `~${p.typical_decision_weeks} weeks` : null;
              const followOn = p.does_follow_on == null ? null : (p.does_follow_on ? 'Reserves for follow-on' : 'First cheque only');
              const empty = !ticket && !instruments && !role && !deploy && !perYear && !p.active_fund
                && !decisionTime && !p.decision_process && !followOn;
              return empty ? <p className="mt-3 text-[13px] text-white/50">Nothing more here yet.</p> : (
                <div className="mt-2 space-y-2.5">
                  {ticket && <Field label="Ticket">{ticket}</Field>}
                  {instruments && <Field label="Instruments">{instruments}</Field>}
                  {role && <Field label="Role in the round">{role}</Field>}
                  {deploy && <Field label="Yearly investment budget">{deploy}</Field>}
                  {perYear && <Field label="Deals per year">{perYear}</Field>}
                  {p.active_fund && <Field label="Active fund">{p.active_fund}</Field>}
                  {decisionTime && <Field label="Typical decision time">{decisionTime}</Field>}
                  {p.decision_process && <Field label="Who decides">{p.decision_process}</Field>}
                  {followOn && <Field label="Follow-on">{followOn}</Field>}
                </div>
              );
            })()}

            {/* Slide 3 (i=2) — Track record (A.4). founded_year deliberately
                dropped (0/9 profiles have it — never rendered to anyone
                since it existed); member_since (Block C) is the safe
                always-available substitute. */}
            {i === 2 && (() => {
              const empty = !p.portfolio_companies && !p.recent_investments && !p.usual_co_investors && !activity;
              return empty ? <p className="mt-3 text-[13px] text-white/50">Nothing more here yet.</p> : (
                <div className="mt-2 space-y-2.5">
                  {p.portfolio_companies && <Field label="Portfolio">{p.portfolio_companies}</Field>}
                  {p.recent_investments && <Field label="Recent investments">{p.recent_investments}</Field>}
                  {p.usual_co_investors && <Field label="Usually invests with">{p.usual_co_investors}</Field>}
                  <ActivityBand activity={activity} />
                </div>
              );
            })()}

            {/* Slide 4 (i=3) — Fit & fences (A.5): where this investor fits,
                and where they never will. "Does not invest in" is the most
                valuable field on the whole card — visually distinct on
                purpose, never color-only (the label itself says what it is). */}
            {i === 3 && (() => {
              const exclusions = [...p.exclusions_sectors, ...(p.exclusions_notes ? [p.exclusions_notes] : [])];
              const coldContact = p.accepts_cold_contact == null ? null : (p.accepts_cold_contact ? 'Open to cold approaches' : 'Warm intros only');
              const boardSeat = p.takes_board_seat
                ? { always: 'Always takes a board seat', sometimes: 'Sometimes takes a board seat', never: "Doesn't take board seats" }[p.takes_board_seat] ?? p.takes_board_seat
                : null;
              const empty = geographies.length === 0 && p.sectors.length === 0 && stages.length === 0
                && p.phases_accepted.length === 0 && p.company_types.length === 0 && !specificCriteria
                && p.focus_keywords.length === 0 && exclusions.length === 0 && !coldContact && !boardSeat;
              return empty ? <p className="mt-3 text-[13px] text-white/50">Nothing more here yet.</p> : (
                <div className="mt-2 space-y-2.5">
                  {coldContact && <Field label="Cold contact">{coldContact}</Field>}
                  {geographies.length > 0 && <Field label="Geographies">{geographies.join(' · ')}</Field>}
                  {p.sectors.length > 0 && <Field label="Sectors">{p.sectors.join(' · ')}</Field>}
                  {stages.length > 0 && <Field label="Stages">{stages.join(' · ')}</Field>}
                  {p.phases_accepted.length > 0 && <Field label="Company phases">{p.phases_accepted.join(' · ')}</Field>}
                  {p.company_types.length > 0 && <Field label="Company types">{p.company_types.join(' · ')}</Field>}
                  {specificCriteria && <Field label="What they look for">{specificCriteria}</Field>}
                  {p.focus_keywords.length > 0 && <Field label="Focus">{p.focus_keywords.join(' · ')}</Field>}
                  {boardSeat && <Field label="Board seat">{boardSeat}</Field>}
                  {exclusions.length > 0 && <Field label="Does not invest in" warn>{exclusions.join(' · ')}</Field>}
                </div>
              );
            })()}
          </>
        ) : (
          <StartupMiniPitch i={i} pitchData={pitchData ?? null} phaseChip={stages} hiddenFields={hidden} />
        )}
        </div>
      </div>
    </div>
  );
}

// Fixed threshold in px rather than a fraction of card width: the card is
// the same size on every phone this ships to, and a fraction made the
// gesture feel inconsistent between the projector view and a handset.
const SWIPE_THRESHOLD = 96;

export function MatchDealDeck({ viewerProfileId, viewerKind, deckLimit }: { viewerProfileId: string; viewerKind: 'startup' | 'investor'; deckLimit?: number }) {
  const [deck, setDeck] = useState<MatchDealProfile[] | null>(null);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [matchNotice, setMatchNotice] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [drag, setDrag] = useState({ x: 0, y: 0, active: false });
  const [flyOut, setFlyOut] = useState<'like' | 'pass' | null>(null);
  const [subIndex, setSubIndex] = useState(0);
  const [subSlideDir, setSubSlideDir] = useState<'up' | 'down' | null>(null);
  const [showBoostSheet, setShowBoostSheet] = useState(false);
  const [boostBusy, setBoostBusy] = useState(false);
  const [boostError, setBoostError] = useState<string | null>(null);
  const [showHypeList, setShowHypeList] = useState(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  // Prompt 125 Block C — "reconsider" a pass (the ONLY undo the backend
  // actually supports: matchdeal_undo_swipe converts a 'pass' row into a
  // 'like', per its own SQL body — it errors on anything that isn't
  // currently a pass). This is NOT "undo an accidental like" (the doc's
  // own wording) — no RPC exists for that today, and adding one would be a
  // matching-engine schema change, out of scope here. Flagged, not built:
  // see this file's own header note near the deck's return value.
  const [lastPass, setLastPass] = useState<{ profileId: string; name: string } | null>(null);
  const [reconsiderBusy, setReconsiderBusy] = useState(false);

  // Prompt 93 — fetchDeck used to only ever run once per true React mount
  // (deps: [viewerProfileId], which never changes across a session). An
  // installed PWA left backgrounded rather than killed can sit on that one
  // stale fetch for days — found live: matchdeal_eligible_deck's own
  // replay-mode reset (deleting swipes once every candidate has been
  // liked) is correct and fires the instant the function is actually
  // called, but a component that never re-mounts never calls it again, so
  // the reset condition can sit true for days with nothing to trigger it.
  // Re-running this on visibilitychange (same pattern /pair/page.tsx
  // already uses for its own self-check) closes that gap without touching
  // matchdeal_eligible_deck itself at all.
  const fetchDeck = useCallback(async () => {
    const sb = browserClient();
    // Prompt 121 §2.7-b — deckLimit (startup viewers only) caps the visible
    // investor population by company-profile completeness tier; investor
    // viewers keep the original fixed 10. matchdeal_eligible_deck itself is
    // unchanged — this is just its existing p_limit argument.
    const { data, error } = await sb.rpc('matchdeal_eligible_deck', { p_viewer_profile_id: viewerProfileId, p_limit: deckLimit ?? 10 });
    if (error) { setLoadError(true); setDeck([]); return; }
    setDeck((data ?? []) as MatchDealProfile[]);
    setIndex(0);
  }, [viewerProfileId, deckLimit]);

  useEffect(() => { void fetchDeck(); }, [fetchDeck]);

  useEffect(() => {
    function onVisible() { if (document.visibilityState === 'visible') void fetchDeck(); }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [fetchDeck]);

  const current = deck?.[index] ?? null;
  const next = deck?.[index + 1] ?? null;

  useEffect(() => { setSubIndex(0); setSubSlideDir(null); }, [index]);

  useEffect(() => {
    if (!current) return;
    browserClient()
      .rpc('matchdeal_record_exposure', { p_viewer_profile_id: viewerProfileId, p_shown_profile_id: current.id })
      .then(() => {}, () => {});
  }, [current, viewerProfileId]);

  // Addenda 2026-08-02 — the deck coming back empty could mean "hit the
  // weekly plan limit" or "pool genuinely has no eligible candidates left";
  // only fetched once the deck is actually empty, so this never runs on the
  // common path of a deck with cards in it.
  const [quota, setQuota] = useState<{ deckSize: number; remaining: number; resetsAt: string } | null>(null);
  useEffect(() => {
    if (current || loadError || deck === null) { setQuota(null); return; }
    let cancelled = false;
    browserClient().rpc('matchdeal_weekly_quota_status', { p_viewer_profile_id: viewerProfileId }).then(({ data, error }) => {
      if (cancelled || error || !data || data.length === 0) return;
      setQuota({ deckSize: data[0].deck_size, remaining: data[0].remaining, resetsAt: data[0].resets_at });
    });
    return () => { cancelled = true; };
  }, [current, loadError, deck, viewerProfileId]);

  // Prompt 98 — the mini-pitch content for the current startup card lives in
  // orgs/company_people, unreachable directly from the client (see
  // matchdeal_startup_pitch_data's own header comment). Fetched once per
  // card change, not per sub-card swipe — all 4 slides share one payload.
  const [pitchData, setPitchData] = useState<PitchData | null>(null);
  useEffect(() => {
    if (!current || current.kind !== 'startup') { setPitchData(null); return; }
    setPitchData(null);
    let cancelled = false;
    browserClient().rpc('matchdeal_startup_pitch_data', { p_profile_id: current.id }).then(({ data, error }) => {
      if (cancelled || error || !data || data.length === 0) return;
      setPitchData(data[0] as PitchData);
    });
    return () => { cancelled = true; };
  }, [current]);

  // Toasts clear themselves; an error that stays forever would hide the
  // rest of the deck, which is what the first version did on a like-limit.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!matchNotice) return;
    const t = setTimeout(() => setMatchNotice(null), 3600);
    return () => clearTimeout(t);
  }, [matchNotice]);

  const commit = useCallback(async (direction: 'like' | 'pass') => {
    if (!current || busy) return;
    setBusy(true);
    setFlyOut(direction);
    try {
      const { data, error } = await browserClient().rpc('matchdeal_record_swipe', {
        p_actor_profile_id: viewerProfileId, p_target_profile_id: current.id, p_direction: direction,
      });
      if (error) {
        // The card must go back where it was — the swipe did not happen.
        setFlyOut(null);
        setDrag({ x: 0, y: 0, active: false });
        setToast(
          error.message.includes('LIKE_LIMIT')
            ? "That's every Like your plan includes this week."
            : 'Could not record that — try again.',
        );
        return;
      }
      if (data) setMatchNotice("It's a match!");
      setLastPass(direction === 'pass' ? { profileId: current.id, name: current.entity_name ?? (current.kind === 'startup' ? 'this startup' : 'this investor') } : null);
      // Let the exit animation finish before the next card becomes current.
      await new Promise((r) => setTimeout(r, 220));
      setIndex((i) => i + 1);
      setDrag({ x: 0, y: 0, active: false });
      setFlyOut(null);
    } finally {
      setBusy(false);
    }
  }, [current, busy, viewerProfileId]);

  // Reconsider clears itself after a while (matches the toast pattern
  // above) — an "Undo" affordance that lingers forever past the moment it
  // applies to is more confusing than useful.
  useEffect(() => {
    if (!lastPass) return;
    const t = setTimeout(() => setLastPass(null), 8000);
    return () => clearTimeout(t);
  }, [lastPass]);

  async function reconsider() {
    if (!lastPass || reconsiderBusy) return;
    setReconsiderBusy(true);
    try {
      const { error } = await browserClient().rpc('matchdeal_undo_swipe', {
        p_actor_profile_id: viewerProfileId, p_target_profile_id: lastPass.profileId,
      });
      if (error) {
        setToast(error.message.includes('LIMIT') ? "That's every reconsideration your plan includes this week." : 'Could not reconsider — try again.');
        return;
      }
      setToast(`Changed to Like — ${lastPass.name}`);
      setLastPass(null);
    } finally {
      setReconsiderBusy(false);
    }
  }

  // Prompt 143 — matchdeal_activate_super_like already exists and is tested
  // at the DB layer (tier_b gate, 1x/week via super_like_used_at); this is
  // only the UI wire-up, no schema change. It ALSO records a 'like' swipe
  // server-side (its own SQL body ends in `perform matchdeal_record_swipe`)
  // — a successful boost advances the deck the same way a plain like does.
  // One real gap, not silently papered over: matchdeal_activate_super_like
  // returns void, unlike matchdeal_record_swipe (which returns the new
  // match id) — so a boost that happens to create a mutual match can't
  // trigger this screen's "It's a match!" celebration the way a normal
  // like does. The match still lands (matchdeal_handle_mutual_match ran),
  // it just surfaces later rather than instantly here. Fixing that needs
  // the RPC's own return shape to change — a real (if small) schema touch,
  // out of scope for "wire the existing backend to UI."
  async function activateBoost() {
    if (!current || boostBusy) return;
    setBoostBusy(true);
    setBoostError(null);
    try {
      const { error } = await browserClient().rpc('matchdeal_activate_super_like', {
        p_actor_profile_id: viewerProfileId, p_target_profile_id: current.id,
      });
      if (error) {
        setBoostError(
          error.message.includes('SUPER_LIKE_NOT_AVAILABLE')
            ? 'Boost is only available on the List of Suspects plan or higher.'
            : error.message.includes('SUPER_LIKE_ALREADY_USED')
              ? "You've already used this week's Boost."
              : 'Could not boost — try again.',
        );
        return;
      }
      setShowBoostSheet(false);
      setToast(`Boosted — ${current.entity_name ?? 'this profile'}`);
      setLastPass(null);
      await new Promise((r) => setTimeout(r, 220));
      setIndex((i) => i + 1);
      setDrag({ x: 0, y: 0, active: false });
    } finally {
      setBoostBusy(false);
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    if (busy || !current) return;
    startRef.current = { x: e.clientX, y: e.clientY };
    setDrag({ x: 0, y: 0, active: true });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!startRef.current) return;
    setDrag({ x: e.clientX - startRef.current.x, y: e.clientY - startRef.current.y, active: true });
  }
  // Prompt 125 Block C — pulled out of onPointerUp so the new visible ▲/▼
  // chevrons (gestures are undiscoverable and, per the reported bug,
  // fragile on real mobile — buttons are the affordance that always
  // works, and the accessible one) drive the exact same logic as the drag
  // gesture, never a second implementation of "what happens on up/down."
  function goToNextSubCard() {
    if (!current) return;
    setSubSlideDir('up');
    setSubIndex((s) => Math.min(s + 1, subCardCountFor(current.kind) - 1));
  }
  function goToPrevSubCardOrBoost() {
    if (subIndex > 0) { setSubSlideDir('down'); setSubIndex((s) => s - 1); }
    else { setBoostError(null); setShowBoostSheet(true); }
  }

  // Prompt 91 §2.1 — direction corrected (found live, reported wrong the
  // moment Bloco 1 shipped): up reveals the next stories-style sub-card
  // (the mini-pitch, moving forward), down goes back a sub-card or — at the
  // first one, nothing left to go back to — opens the Boost confirmation.
  // Whichever axis moved further wins, so a mostly-horizontal drag never
  // triggers this by accident.
  function onPointerUp() {
    if (!startRef.current) return;
    const { x, y } = drag;
    startRef.current = null;
    if (Math.abs(y) > Math.abs(x) && Math.abs(y) > SWIPE_THRESHOLD) {
      if (y < 0) goToNextSubCard(); else goToPrevSubCardOrBoost();
      setDrag({ x: 0, y: 0, active: false });
      return;
    }
    if (x > SWIPE_THRESHOLD) { void commit('like'); return; }
    if (x < -SWIPE_THRESHOLD) { void commit('pass'); return; }
    setDrag({ x: 0, y: 0, active: false });
  }

  const offsetX = flyOut ? (flyOut === 'like' ? 620 : -620) : drag.x;
  const offsetY = flyOut ? -60 : drag.y * 0.35;
  const rotation = offsetX / 18;
  const likeOpacity = Math.min(Math.max(offsetX / SWIPE_THRESHOLD, 0), 1);
  const passOpacity = Math.min(Math.max(-offsetX / SWIPE_THRESHOLD, 0), 1);
  const settling = !drag.active || !!flyOut;

  const counter = useMemo(() => {
    if (!deck || deck.length === 0) return null;
    return `${Math.min(index + 1, deck.length)} of ${deck.length} this week`;
  }, [deck, index]);

  if (deck === null) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-white/60">Loading this week&apos;s profiles…</p>
      </div>
    );
  }

  if (!current) {
    const audience = viewerKind === 'startup' ? 'investor' : 'startup';
    const weeklyLimitHit = !loadError && quota != null && quota.remaining === 0;
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
        <div className="text-4xl">{loadError ? '⚠️' : '✓'}</div>
        <p className="mt-3 text-[15px] font-semibold text-white">
          {loadError
            ? 'Could not load candidates'
            : weeklyLimitHit
              ? `Your plan allows you ${quota!.deckSize} profiles a week`
              : `You've seen every ${audience} for this week`}
        </p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-white/60">
          {loadError
            ? 'Check your connection and reopen this screen.'
            : weeklyLimitHit
              ? `You've seen all of them — new profiles unlock on ${new Date(quota!.resetsAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}.`
              : 'New profiles unlock when your weekly allowance renews.'}
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex flex-1 flex-col">
      {/* Prompt 143 — Hype List v1 trigger. Investor-only (the list is
          "which startups are trending," a discovery aid for the side that's
          picking among many, not something a startup viewer needs). Kept
          outside the card's own touch-none/pointer-capture div, same
          reasoning as the ▲/▼ chevrons below. */}
      {viewerKind === 'investor' && (
        <button type="button" onClick={() => setShowHypeList(true)}
          className="absolute right-4 top-2 z-10 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">
          🔥 Hype List
        </button>
      )}
      <div className="relative flex-1 px-4 pb-1 pt-1">
        {/* Card behind, so the deck reads as a stack rather than a single
            card that blinks out of existence on every swipe. */}
        {next && (
          <div className="absolute inset-x-4 inset-y-1 scale-[0.94] opacity-60" style={{ transform: 'scale(.94) translateY(10px)' }}>
            <CardFace p={next} />
          </div>
        )}

        <div
          key={current.id}
          role="group"
          aria-label={`${current.entity_name ?? 'Profile'} — drag right to like, left to pass, up for more, down to boost`}
          className="absolute inset-x-4 inset-y-1 touch-none select-none matchdeal-card-promote"
          style={{
            transform: `translate(${offsetX}px, ${offsetY}px) rotate(${rotation}deg)`,
            transition: settling ? 'transform 220ms cubic-bezier(.16,1,.3,1)' : 'none',
            cursor: busy ? 'default' : 'grab',
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <CardFace p={current} subIndex={subIndex} active pitchData={pitchData} slideDir={subSlideDir} />

          <div
            className="pointer-events-none absolute left-5 top-5 rotate-[-12deg] rounded-xl border-[3px] border-emerald-400 px-3 py-1 text-[22px] font-black tracking-wider text-emerald-400"
            style={{ opacity: likeOpacity }}
          >
            LIKE
          </div>
          <div
            className="pointer-events-none absolute right-5 top-5 rotate-[12deg] rounded-xl border-[3px] border-rose-400 px-3 py-1 text-[22px] font-black tracking-wider text-rose-400"
            style={{ opacity: passOpacity }}
          >
            PASS
          </div>
        </div>

        {/* Prompt 125 Block C — visible ▲/▼ affordances, siblings of the
            draggable card (not inside its touch-none/pointer-capture div,
            so they're never at risk of fighting the drag gesture). Same
            goToNextSubCard/goToPrevSubCardOrBoost the gesture itself
            calls — gestures stay as a shortcut, these are the path that
            always works, on any device, and for keyboard/screen-reader
            use. */}
        <div className="absolute bottom-6 right-6 z-10 flex flex-col gap-2.5">
          <button type="button" onClick={goToNextSubCard} disabled={busy} aria-label="Next slide"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-[16px] text-white backdrop-blur-sm transition active:scale-95 disabled:opacity-40">
            ▲
          </button>
          <button type="button" onClick={goToPrevSubCardOrBoost} disabled={busy} aria-label={subIndex > 0 ? 'Previous slide' : 'Boost this profile'}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-[16px] text-white backdrop-blur-sm transition active:scale-95 disabled:opacity-40">
            {subIndex > 0 ? '▼' : '🚀'}
          </button>
        </div>
      </div>

      {/* Prompt 125 Block C — "reconsider" a pass (see this file's own
          header note near lastPass's declaration for exactly what this
          does and doesn't cover). Self-clears after 8s, same as the toast
          below it. */}
      {lastPass && (
        <div className="absolute inset-x-4 top-2 z-10 flex items-center gap-2 rounded-2xl bg-slate-800/95 px-4 py-2.5 text-[13px] text-white shadow-lg">
          <span className="flex-1">Passed on {lastPass.name}</span>
          <button type="button" onClick={() => void reconsider()} disabled={reconsiderBusy}
            className="shrink-0 rounded-full bg-white/15 px-3 py-1 text-[12px] font-semibold disabled:opacity-40">
            {reconsiderBusy ? 'Reconsidering…' : 'Reconsider'}
          </button>
        </div>
      )}

      {/* A match is the whole point of the product, so it gets the screen
          rather than a strip pasted over the bottom of the card. Tapping
          anywhere dismisses it; it also clears itself, so a demo never
          gets stuck behind it. */}
      {matchNotice && (
        <div
          role="status"
          onClick={() => setMatchNotice(null)}
          className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#0B1220]/80 px-8 text-center backdrop-blur-sm"
        >
          <div className="text-[64px] leading-none">🎉</div>
          <p className="mt-4 bg-gradient-to-r from-emerald-300 to-orange-300 bg-clip-text text-[32px] font-extrabold text-transparent">
            {matchNotice}
          </p>
          <p className="mt-2 text-[14px] leading-relaxed text-white/70">
            You both said yes. Sherlock Deal will open the conversation from here.
          </p>
          <span className="mt-6 text-[12px] uppercase tracking-widest text-white/35">Tap to continue</span>
        </div>
      )}

      {/* Prompt 81 Bloco 1 — swipe-up opens this, it never boosts on its
          own. Prompt 143 — now calls matchdeal_activate_super_like for
          real; the RPC's own errors (plan gate, weekly limit) get a clear
          message here instead of a generic one. */}
      {showBoostSheet && (
        <div
          role="dialog" aria-label="Boost this profile"
          className="absolute inset-0 z-20 flex flex-col items-center justify-end bg-[#0B1220]/70 backdrop-blur-sm"
          onClick={() => !boostBusy && setShowBoostSheet(false)}
        >
          <div
            className="w-full rounded-t-3xl border-t border-white/10 bg-[#111a2e] p-6 pb-8 text-center"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-3xl">🚀</div>
            <h2 className="mt-2 text-[17px] font-bold text-white">Boost this profile</h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-white/65">
              Uses your one Boost for this week — {current.entity_name ?? 'this profile'} gets extra visibility, and this counts as a Like.
            </p>
            {boostError && <p className="mt-2 text-[13px] font-medium text-rose-300">{boostError}</p>}
            <div className="mt-5 flex gap-2.5">
              <button
                type="button" onClick={() => setShowBoostSheet(false)} disabled={boostBusy}
                className="flex-1 rounded-full bg-white/10 py-3 text-[14px] font-semibold text-white disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button" onClick={() => void activateBoost()} disabled={boostBusy}
                className="flex-1 rounded-full bg-gradient-to-br from-emerald-400 to-green-600 py-3 text-[14px] font-semibold text-white disabled:opacity-40"
              >
                {boostBusy ? 'Boosting…' : 'Boost'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showHypeList && <HypeListOverlay onClose={() => setShowHypeList(false)} />}

      <div className="relative shrink-0 px-4 pb-2 pt-3">
        {toast && (
          <div className="absolute inset-x-4 -top-9 rounded-2xl bg-slate-800/95 px-4 py-2.5 text-center text-[13px] font-medium text-white shadow-lg">
            {toast}
          </div>
        )}

        <div className="flex items-center justify-center gap-6">
          <button
            type="button" onClick={() => void commit('pass')} disabled={busy} aria-label="Pass"
            className="flex h-16 w-16 items-center justify-center rounded-full border border-white/15 bg-white text-[26px] font-bold text-rose-500 shadow-lg transition active:scale-95 disabled:opacity-40"
          >
            ✕
          </button>
          <button
            type="button" onClick={() => void commit('like')} disabled={busy} aria-label="Like"
            className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-green-600 text-[26px] text-white shadow-lg transition active:scale-95 disabled:opacity-40"
          >
            ♥
          </button>
        </div>

        <p className="mt-3 text-center text-[11px] font-medium tracking-wide text-white/45">
          {counter} · swipe or tap · ↑ for more, ↓ to boost
        </p>
      </div>
    </div>
  );
}
