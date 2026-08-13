'use client';
// Prompt 166 §C — SWOT quadrant, the first element of the Review sub-tab.
// Reads the 4 bullet arrays off the latest already-stored review_runs
// report (via the `data` prop, passed down from ReviewPanel's own
// already-fetched `runs`) — makes NO AI call of its own, zero extra token
// cost per Nuno's own instruction.
//
// SwotQuadrant is the bare header + 2x2 grid, exported separately so the
// investor-facing dossier page (Prompt 166 §D) can reuse the exact same
// layout read-only, without pulling in the founder-only run/lock/CTA
// wrapper below it.
import { Card } from '@/components/ui';
import type { SwotData } from '@/lib/types';
import { ClarificationBullet } from './ClarificationBullet';
import { clarificationKey, type ReviewClarification } from '@/lib/review-clarifications';

// Prompt 173 §A — the structure (gradient header, white/thin-border
// quadrant card, dot-list rows) already matched the reference per Prompt
// 172; what still read as "chat" was the emoji badges (💪⚠️🚀⚡) — the
// reference uses flat single-stroke outline icons, no skin tone/expression.
// No icon library in package.json (checked — neither lucide-react nor
// heroicons is a dependency), so these are hand-built inline outline SVGs
// (own geometry, not copied from any library's path data, to sidestep any
// licensing question) rather than a new dependency for 5 icons — same
// "inline SVG, no new lib" pattern the rest of this app already uses for
// one-off icons. Every icon shares one stroke contract: fill="none"
// stroke="currentColor" strokeWidth={2}, round caps/joins, 24x24 viewBox —
// color comes for free from the badge's own text-white.
function IconShieldCheck({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M12 3l7 3v5.5c0 4.7-3 8.4-7 9.5-4-1.1-7-4.8-7-9.5V6l7-3z" />
      <path d="M9 12l2 2 4-4.5" />
    </svg>
  );
}
function IconLinkOff({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M4 9a3 3 0 0 1 3-3h2" />
      <path d="M8 15H6a3 3 0 0 1-3-3" />
      <path d="M16 9h2a3 3 0 0 1 3 3" />
      <path d="M20 15a3 3 0 0 1-3 3h-2" />
      <path d="M8 12h1M15 12h1" />
    </svg>
  );
}
function IconTrendingUp({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </svg>
  );
}
function IconTriangleAlert({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M12 3.5l9.5 16.5H2.5L12 3.5z" />
      <path d="M12 10v4" />
      <path d="M12 17.2h.01" />
    </svg>
  );
}
function IconChartTrending({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      <path d="M7 14l3.5-3.5L13 13l5-5" />
      <path d="M18 8h4v4" />
    </svg>
  );
}

// Prompt 186 §4 — purely decorative curve + 3 dots, colored by the
// quadrant's own theme, in the top-right corner opposite the icon badge —
// matches the reference image exactly, no meaning attached to it (not a
// control, not a link).
function CornerFlourish({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 56 56" fill="none" className={className} aria-hidden="true">
      <path d="M4 30C4 15.6 15.6 4 30 4" stroke="currentColor" strokeWidth={2} strokeLinecap="round" opacity={0.35} />
      <circle cx="41" cy="8" r="1.8" fill="currentColor" opacity={0.4} />
      <circle cx="48.5" cy="12.5" r="1.8" fill="currentColor" opacity={0.4} />
      <circle cx="53" cy="19" r="1.8" fill="currentColor" opacity={0.4} />
    </svg>
  );
}

// Prompt 186 — shared "soft, big-blur" card shadow (item 6): replaces the
// generic shadow-sm every quadrant card used before, which read as a hard
// outline rather than elevation.
const CARD_SHADOW = 'shadow-[0_10px_28px_-10px_rgba(15,23,42,0.16)]';

// Prompt 172 §B — v2 redesign: Prompt 170's tinted-container + filled-item
// treatment still read as chat bubbles, not a product card. This drops the
// quadrant's own colored background (now plain white, only a thin colored
// border carries the category color) and replaces each item's filled
// mini-card with a plain outlined row + a small color dot (no icon) — the
// "chat" read came from white bubbles floating on a tinted wash, not from
// any one piece in isolation. Weaknesses moves orange -> amber/gold and
// Threats moves the dark #B00000 -> a brighter red/coral, both to match the
// reference; Strengths/Opportunities keep their existing hues.
const QUADRANTS: {
  key: keyof SwotData; label: string; caption: string; Icon: (p: { className?: string }) => JSX.Element;
  border: string; iconBadge: string; countPill: string; dot: string;
  // Prompt 186 — cardBg (item 3, subtle top-to-white tint) and flourish
  // (item 4's CornerFlourish color) are new; iconBadge now carries its own
  // gradient + dedicated shadow (item 2) instead of a flat fill.
  cardBg: string; flourish: string;
}[] = [
  {
    key: 'strengths', label: 'Strengths', caption: 'What gives you a competitive advantage?', Icon: IconShieldCheck,
    border: 'border-emerald-200', iconBadge: 'bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-md shadow-emerald-500/30',
    countPill: 'border-emerald-200 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500',
    cardBg: 'bg-gradient-to-b from-emerald-50 via-white to-white', flourish: 'text-emerald-400',
  },
  {
    key: 'weaknesses', label: 'Weaknesses', caption: 'What are your main limitations?', Icon: IconLinkOff,
    border: 'border-amber-200', iconBadge: 'bg-gradient-to-br from-amber-400 to-amber-600 shadow-md shadow-amber-500/30',
    countPill: 'border-amber-200 bg-amber-50 text-amber-700', dot: 'bg-amber-500',
    cardBg: 'bg-gradient-to-b from-amber-50 via-white to-white', flourish: 'text-amber-400',
  },
  {
    key: 'opportunities', label: 'Opportunities', caption: 'What external factors could help you?', Icon: IconTrendingUp,
    border: 'border-blue-200', iconBadge: 'bg-gradient-to-br from-blue-400 to-blue-600 shadow-md shadow-blue-500/30',
    countPill: 'border-blue-200 bg-blue-50 text-blue-700', dot: 'bg-blue-500',
    cardBg: 'bg-gradient-to-b from-blue-50 via-white to-white', flourish: 'text-blue-400',
  },
  {
    key: 'threats', label: 'Threats', caption: 'What external risks could impact you?', Icon: IconTriangleAlert,
    border: 'border-red-200', iconBadge: 'bg-gradient-to-br from-red-400 to-red-600 shadow-md shadow-red-500/30',
    countPill: 'border-red-200 bg-red-50 text-red-600', dot: 'bg-red-500',
    cardBg: 'bg-gradient-to-b from-red-50 via-white to-white', flourish: 'text-red-400',
  },
];

// Prompt 172 §A — full-width header card above the 4 quadrants: brand
// gradient (#0E7490 -> #22D3EE, the exact two-tone pair brand.ts itself
// names as the product's colours — not a new/invented gradient), a bigger
// icon badge than the quadrants use, title + purpose subtitle, and a
// translucent "Tip" callout on the right. No dedicated reusable "Tip"
// component exists elsewhere in the app (checked — PipelinePanel.tsx's own
// 💡 hint is just an ad hoc styled box, not a shared component), so this
// reuses that same spirit — icon + short line in a light box — rather than
// inventing an unrelated visual language.
// Prompt 173 §A — 📊 emoji swapped for the same outline-icon treatment as
// the quadrants below.
function SwotHeader() {
  return (
    <div className="relative overflow-hidden rounded-2xl p-5" style={{ background: 'linear-gradient(135deg, #0E7490 0%, #22D3EE 100%)' }}>
      {/* Prompt 186 §1 — subtle glass-reflection shine, top-left corner.
          Purely decorative (pointer-events-none), painted behind the
          header's real content below via DOM order + that content's own
          `relative`. */}
      <div aria-hidden="true" className="pointer-events-none absolute -left-12 -top-16 h-48 w-48 rounded-full bg-white/25 blur-2xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -left-2 -top-6 h-20 w-40 rotate-[-18deg] rounded-full bg-white/10 blur-xl" />
      {/* Three-dot "more options" affordance — decorative only per the
          prompt's own note ("mesmo que não faça nada ainda"), nothing wired
          up behind it yet. */}
      <div aria-hidden="true" className="pointer-events-none absolute right-5 top-4 flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-white/60" />
        <span className="h-1.5 w-1.5 rounded-full bg-white/60" />
        <span className="h-1.5 w-1.5 rounded-full bg-white/60" />
      </div>
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/20 text-white">
            <IconChartTrending className="h-7 w-7" />
          </span>
          <div>
            <div className="text-xl font-bold text-white">SWOT Analysis</div>
            <p className="mt-0.5 max-w-md text-sm text-cyan-50/90">
              Evaluate internal strengths and weaknesses, and external opportunities and threats to guide your fundraising strategy.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-start gap-2 rounded-xl bg-white/95 px-3.5 py-2.5 shadow-sm">
          <span aria-hidden="true" className="text-base">💡</span>
          <div>
            <div className="text-xs font-semibold text-gray-800">Tip</div>
            <p className="max-w-[220px] text-[11px] leading-snug text-gray-600">
              Focus on what&apos;s material for investors and your next funding round.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Prompt 168 §B — `clarify` is only ever passed by SwotVisualCard's own
// founder-facing wrapper below (the latest run, editable). The
// investor-facing dossier page (Prompt 166 §D) renders SwotQuadrant
// directly with no `clarify` prop, so it stays exactly the plain read-only
// grid it's always been — the bubble/editor UI never reaches that surface.
// Prompt 170/172/173 — the redesign below applies to BOTH surfaces
// automatically (same shared component), no extra work needed for the
// investor side.
export function SwotQuadrant({ data, clarify }: {
  data: SwotData;
  clarify?: { orgId: string; reviewRunId: string; clarifications: Map<string, ReviewClarification>; onSaved: (c: ReviewClarification) => void };
}) {
  return (
    <div className="space-y-4">
      <SwotHeader />
      {/* Prompt 173 §C — items-stretch (already the default for a CSS grid
          row, made explicit here) so all 4 quadrants share the row's
          tallest card's height — a category with 6-7 items grows the card,
          it never compresses its own line spacing to fit a shorter
          neighbor's box, and no quadrant scrolls internally on its own. */}
      <div className="grid items-stretch gap-4 sm:grid-cols-2">
        {QUADRANTS.map((q) => {
          const items = data[q.key] ?? [];
          const Icon = q.Icon;
          return (
            <div key={q.key} className={`relative overflow-hidden rounded-2xl border p-4 ${CARD_SHADOW} ${q.border} ${q.cardBg}`}>
              {/* Prompt 186 §4 — behind everything else (-z-10) so it never
                  competes with the count pill it sits near. */}
              <CornerFlourish className={`pointer-events-none absolute -right-1 -top-1 -z-10 h-12 w-12 ${q.flourish}`} />
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  {/* Prompt 173 §B — h-10 w-10 -> h-12 w-12, icon itself
                      h-6 w-6 (was the emoji at text-lg). Prompt 186 §2 —
                      iconBadge now carries its own from/to gradient +
                      shadow-{color}/30, replacing the flat fill + the
                      card-wide shadow-sm this used to lean on. */}
                  <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white ${q.iconBadge}`}>
                    <Icon className="h-6 w-6" />
                  </span>
                  <div>
                    <div className="text-base font-bold text-gray-900">{q.label}</div>
                    <div className="text-xs text-gray-500">{q.caption}</div>
                  </div>
                </div>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${q.countPill}`}>
                  {items.length} item{items.length === 1 ? '' : 's'}
                </span>
              </div>
              {items.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {items.map((item, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-full border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-800">
                      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${q.dot}`} />
                      <span className="flex-1">{item}</span>
                      {clarify && (
                        <ClarificationBullet
                          orgId={clarify.orgId} reviewRunId={clarify.reviewRunId} category={q.key} itemIndex={i} itemText={item}
                          existing={clarify.clarifications.get(clarificationKey(clarify.reviewRunId, q.key, i)) ?? null}
                          onSaved={clarify.onSaved}
                        />
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 rounded-lg border border-dashed border-gray-200 px-3 py-2.5 text-sm text-gray-400">Nothing flagged.</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SwotVisualCard({ data, canRun, lockedReason, running, onRun, clarify }: {
  data: SwotData | null;
  /** Whether a NEW review can be started right now (feature on + quota left). */
  canRun: boolean;
  /** Set (non-empty) when there's no `data` yet AND a new review can't be started either
   *  — quota exhausted or the feature isn't on for this plan. Renders the frost/lock
   *  treatment instead of the plain "run a review" empty state (§C.4). */
  lockedReason: string | null;
  running: boolean;
  onRun: () => void;
  /** Prompt 168 §B — omit to render the quadrant read-only (no `data` means
   *  there's nothing to clarify yet anyway). */
  clarify?: { orgId: string; reviewRunId: string; clarifications: Map<string, ReviewClarification>; onSaved: (c: ReviewClarification) => void };
}) {
  return (
    <Card title={data ? undefined : <span className="text-[#0E7490]">SWOT snapshot</span>}>
      {data ? (
        <SwotQuadrant data={data} clarify={clarify} />
      ) : lockedReason ? (
        <div className="relative overflow-hidden rounded-lg border border-dashed border-gray-200 bg-white/60 px-4 py-6 text-center backdrop-blur-[2px]">
          <span className="rounded-full border border-cyan-200 bg-white/90 px-3 py-1 text-xs font-semibold text-[#0E7490] shadow-sm">
            {lockedReason}
          </span>
          <p className="mt-2 text-[11px] text-gray-400">Your SWOT will appear here once a review can run again.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center">
          <p className="text-sm text-gray-500">Run a review to see your SWOT here.</p>
          <button disabled={!canRun || running} onClick={onRun}
            className="mt-2 rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
            {running ? 'Running…' : 'Run review'}
          </button>
        </div>
      )}
    </Card>
  );
}
