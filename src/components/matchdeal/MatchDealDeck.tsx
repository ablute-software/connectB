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
// RPCs called under RLS. No schema change ships with this.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browserClient } from '@/lib/supabase';

interface MatchDealProfile {
  id: string; kind: 'startup' | 'investor'; entity_name: string | null; photo_url: string | null;
  entity_logo_url: string | null; description: string | null; sectors: string[]; country: string | null;
  investment_stage_sought: string | null; stages_invested: string[]; founded_year: number | null;
  target_round_amount: number | null; team_summary: string | null; ticket_min: number | null; ticket_max: number | null;
  specific_criteria: string | null; representative_name: string | null; entity_type: string | null;
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

// Prompt 81 Bloco 1 — three stories-style sub-cards per profile, reached by
// swiping down (and back up). Card 0 is the original at-a-glance view
// (unchanged); cards 1/2 surface fields the deck already fetched but never
// rendered anywhere (specific_criteria, team_summary, founded_year, the full
// sector list) — no new data, just more of what's already in the payload.
const SUB_CARD_COUNT = 3;

function CardFace({ p, subIndex, active }: { p: MatchDealProfile; subIndex?: number; active?: boolean }) {
  const name = p.entity_name || (p.kind === 'startup' ? 'A startup' : 'An investor');
  const image = p.photo_url ?? p.entity_logo_url;
  const [from, to] = GRADIENTS[hashString(name) % GRADIENTS.length];
  const stages = p.kind === 'startup'
    ? (p.investment_stage_sought ? [STAGE_LABELS[p.investment_stage_sought] ?? p.investment_stage_sought] : [])
    : p.stages_invested.map((s) => STAGE_LABELS[s] ?? s);
  const money = p.kind === 'startup'
    ? (fmtEur(p.target_round_amount) ? `Raising ${fmtEur(p.target_round_amount)}` : null)
    : (fmtEur(p.ticket_min) || fmtEur(p.ticket_max) ? `Ticket ${fmtEur(p.ticket_min) ?? '—'}–${fmtEur(p.ticket_max) ?? '—'}` : null);
  const i = subIndex ?? 0;

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
          {Array.from({ length: SUB_CARD_COUNT }, (_, s) => (
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

        {i === 1 && (
          <div className="mt-2 space-y-2.5">
            {p.description && <p className="text-[13px] leading-snug text-white/85">{p.description}</p>}
            {p.kind === 'startup' && p.team_summary && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/60">Team</p>
                <p className="text-[13px] leading-snug text-white/85">{p.team_summary}</p>
              </div>
            )}
            {p.kind === 'investor' && p.specific_criteria && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/60">What they look for</p>
                <p className="text-[13px] leading-snug text-white/85">{p.specific_criteria}</p>
              </div>
            )}
            {!p.team_summary && !p.specific_criteria && !p.description && (
              <p className="text-[13px] text-white/50">Nothing more here yet.</p>
            )}
          </div>
        )}

        {i === 2 && (
          <div className="mt-2 space-y-2.5">
            {p.founded_year && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/60">Founded</p>
                <p className="text-[13px] text-white/85">{p.founded_year}</p>
              </div>
            )}
            {p.sectors.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/60">Sectors</p>
                <p className="text-[13px] leading-snug text-white/85">{p.sectors.join(' · ')}</p>
              </div>
            )}
            {stages.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/60">Stages</p>
                <p className="text-[13px] leading-snug text-white/85">{stages.join(' · ')}</p>
              </div>
            )}
            {!p.founded_year && p.sectors.length === 0 && stages.length === 0 && (
              <p className="text-[13px] text-white/50">Nothing more here yet.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Fixed threshold in px rather than a fraction of card width: the card is
// the same size on every phone this ships to, and a fraction made the
// gesture feel inconsistent between the projector view and a handset.
const SWIPE_THRESHOLD = 96;

export function MatchDealDeck({ viewerProfileId, viewerKind }: { viewerProfileId: string; viewerKind: 'startup' | 'investor' }) {
  const [deck, setDeck] = useState<MatchDealProfile[] | null>(null);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [matchNotice, setMatchNotice] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [drag, setDrag] = useState({ x: 0, y: 0, active: false });
  const [flyOut, setFlyOut] = useState<'like' | 'pass' | null>(null);
  const [subIndex, setSubIndex] = useState(0);
  const [showBoostSheet, setShowBoostSheet] = useState(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);

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
    const { data, error } = await sb.rpc('matchdeal_eligible_deck', { p_viewer_profile_id: viewerProfileId, p_limit: 10 });
    if (error) { setLoadError(true); setDeck([]); return; }
    setDeck((data ?? []) as MatchDealProfile[]);
    setIndex(0);
  }, [viewerProfileId]);

  useEffect(() => { void fetchDeck(); }, [fetchDeck]);

  useEffect(() => {
    function onVisible() { if (document.visibilityState === 'visible') void fetchDeck(); }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [fetchDeck]);

  const current = deck?.[index] ?? null;
  const next = deck?.[index + 1] ?? null;

  useEffect(() => { setSubIndex(0); }, [index]);

  useEffect(() => {
    if (!current) return;
    browserClient()
      .rpc('matchdeal_record_exposure', { p_viewer_profile_id: viewerProfileId, p_shown_profile_id: current.id })
      .then(() => {}, () => {});
  }, [current, viewerProfileId]);

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
      // Let the exit animation finish before the next card becomes current.
      await new Promise((r) => setTimeout(r, 220));
      setIndex((i) => i + 1);
      setDrag({ x: 0, y: 0, active: false });
      setFlyOut(null);
    } finally {
      setBusy(false);
    }
  }, [current, busy, viewerProfileId]);

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
      if (y < 0) {
        setSubIndex((s) => Math.min(s + 1, SUB_CARD_COUNT - 1));
      } else {
        if (subIndex > 0) setSubIndex((s) => s - 1);
        else setShowBoostSheet(true);
      }
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
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
        <div className="text-4xl">{loadError ? '⚠️' : '✓'}</div>
        <p className="mt-3 text-[15px] font-semibold text-white">
          {loadError ? 'Could not load candidates' : `You've seen every ${audience} for this week`}
        </p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-white/60">
          {loadError
            ? 'Check your connection and reopen this screen.'
            : 'New profiles unlock when your weekly allowance renews.'}
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex flex-1 flex-col">
      <div className="relative flex-1 px-4 pb-1 pt-1">
        {/* Card behind, so the deck reads as a stack rather than a single
            card that blinks out of existence on every swipe. */}
        {next && (
          <div className="absolute inset-x-4 inset-y-1 scale-[0.94] opacity-60" style={{ transform: 'scale(.94) translateY(10px)' }}>
            <CardFace p={next} />
          </div>
        )}

        <div
          role="group"
          aria-label={`${current.entity_name ?? 'Profile'} — drag right to like, left to pass, up for more, down to boost`}
          className="absolute inset-x-4 inset-y-1 touch-none select-none"
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
          <CardFace p={current} subIndex={subIndex} active />

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
      </div>

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
          own. Boost itself (Bloco 3: matchdeal_boosts, cadence per tier) is
          schema-only tonight — zero rows, zero code wired to it — so this is
          an honest "not live yet" state rather than a Confirm button with
          nothing real behind it. */}
      {showBoostSheet && (
        <div
          role="dialog" aria-label="Boost this profile"
          className="absolute inset-0 z-20 flex flex-col items-center justify-end bg-[#0B1220]/70 backdrop-blur-sm"
          onClick={() => setShowBoostSheet(false)}
        >
          <div
            className="w-full rounded-t-3xl border-t border-white/10 bg-[#111a2e] p-6 pb-8 text-center"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-3xl">🚀</div>
            <h2 className="mt-2 text-[17px] font-bold text-white">Boost this profile</h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-white/65">
              Boosting isn&apos;t live yet — it&apos;s coming to MatchDeal soon.
            </p>
            <button
              type="button" onClick={() => setShowBoostSheet(false)}
              className="mt-5 w-full rounded-full bg-white/10 py-3 text-[14px] font-semibold text-white"
            >
              Close
            </button>
          </div>
        </div>
      )}

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
