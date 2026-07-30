'use client';
// MatchDeal QR pairing v2, Section 1.1 — the PWA's minimum functional
// scope beyond pairing itself: "pelo menos uma vista útil imediata... os
// novos perfis da semana com swipe direita/esquerda". Built on
// matchdeal_eligible_deck/matchdeal_record_exposure/matchdeal_record_swipe
// — all pre-existing RPCs (confirmed via investigation before writing any
// of this), called directly from the browser under RLS
// (matchdeal_profiles_select_visible already allows any authenticated
// session to read is_visible profiles) — no new backend route needed for
// this piece. Deliberately plain buttons, not drag gestures — "âmbito
// funcional mínimo... verdadeiramente funcional", not a polished clone.
import { useEffect, useState } from 'react';
import { browserClient } from '@/lib/supabase';

interface MatchDealProfile {
  id: string; kind: 'startup' | 'investor'; entity_name: string | null; photo_url: string | null;
  entity_logo_url: string | null; description: string | null; sectors: string[]; country: string | null;
  investment_stage_sought: string | null; stages_invested: string[]; founded_year: number | null;
  target_round_amount: number | null; team_summary: string | null; ticket_min: number | null; ticket_max: number | null;
  specific_criteria: string | null;
}

const STAGE_LABELS: Record<string, string> = {
  pre_seed: 'Pre-seed', seed: 'Seed', series_a: 'Series A', series_b_plus: 'Series B+', growth: 'Growth',
};

function fmtEur(n: number | null) {
  return n == null ? null : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
}

function Card({ p }: { p: MatchDealProfile }) {
  const image = p.photo_url ?? p.entity_logo_url;
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      {image && <img src={image} alt="" className="mb-3 h-40 w-full rounded-xl object-cover" />}
      <h2 className="text-lg font-bold text-gray-900">{p.entity_name || (p.kind === 'startup' ? 'A startup' : 'An investor')}</h2>
      {p.description && <p className="mt-1 text-sm text-gray-600">{p.description}</p>}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
        {p.country && <span>{p.country}</span>}
        {p.kind === 'startup' && p.investment_stage_sought && <span>{STAGE_LABELS[p.investment_stage_sought] ?? p.investment_stage_sought}</span>}
        {p.kind === 'investor' && p.stages_invested.length > 0 && <span>{p.stages_invested.map((s) => STAGE_LABELS[s] ?? s).join(', ')}</span>}
        {p.founded_year && <span>Founded {p.founded_year}</span>}
      </div>
      {p.sectors.length > 0 && <p className="mt-2 text-xs text-gray-500">{p.sectors.join(' · ')}</p>}
      {p.kind === 'startup' && fmtEur(p.target_round_amount) && (
        <p className="mt-2 text-sm text-gray-700">Raising {fmtEur(p.target_round_amount)}</p>
      )}
      {p.kind === 'investor' && (fmtEur(p.ticket_min) || fmtEur(p.ticket_max)) && (
        <p className="mt-2 text-sm text-gray-700">Ticket {fmtEur(p.ticket_min) ?? '—'}–{fmtEur(p.ticket_max) ?? '—'}</p>
      )}
      {p.team_summary && <p className="mt-2 text-xs text-gray-500">{p.team_summary}</p>}
      {p.specific_criteria && <p className="mt-2 text-xs text-gray-500">{p.specific_criteria}</p>}
    </div>
  );
}

export function MatchDealDeck({ viewerProfileId, viewerKind }: { viewerProfileId: string; viewerKind: 'startup' | 'investor' }) {
  const [deck, setDeck] = useState<MatchDealProfile[] | null>(null);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [matchNotice, setMatchNotice] = useState<string | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      const sb = browserClient();
      const { data, error } = await sb.rpc('matchdeal_eligible_deck', { p_viewer_profile_id: viewerProfileId, p_limit: 10 });
      if (error) { setErr('Could not load candidates.'); setDeck([]); return; }
      const cards = (data ?? []) as MatchDealProfile[];
      setDeck(cards);
      // Exposure is per-card-shown, not per-fetch — the deck function
      // itself doesn't record it (confirmed before writing this), so
      // each card is marked shown as it's actually displayed below.
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerProfileId]);

  const current = deck?.[index] ?? null;

  useEffect(() => {
    if (!current) return;
    browserClient().rpc('matchdeal_record_exposure', { p_viewer_profile_id: viewerProfileId, p_shown_profile_id: current.id }).then(() => {}, () => {});
  }, [current, viewerProfileId]);

  async function swipe(direction: 'like' | 'pass') {
    if (!current || busy) return;
    setBusy(true); setMatchNotice(null);
    try {
      const { data, error } = await browserClient().rpc('matchdeal_record_swipe', {
        p_actor_profile_id: viewerProfileId, p_target_profile_id: current.id, p_direction: direction,
      });
      if (error) { setErr(error.message.includes('LIKE_LIMIT') ? 'You&apos;ve reached your weekly like limit.' : 'Could not record that.'); return; }
      if (data) setMatchNotice("It's a match! 🎉");
      setIndex((i) => i + 1);
    } finally {
      setBusy(false);
    }
  }

  if (deck === null) return <p className="text-sm text-gray-400">Loading this week&apos;s profiles…</p>;
  if (err) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!current) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-6 text-center">
        <p className="text-sm text-gray-600">No more profiles this week — check back soon.</p>
      </div>
    );
  }

  return (
    <div>
      {matchNotice && <p className="mb-2 text-center text-sm font-semibold text-emerald-700">{matchNotice}</p>}
      <Card p={current} />
      <div className="mt-3 flex justify-center gap-3">
        <button onClick={() => swipe('pass')} disabled={busy}
          className="rounded-full border border-gray-200 px-6 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40">
          Pass
        </button>
        <button onClick={() => swipe('like')} disabled={busy}
          className="rounded-full bg-[#0E7490] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40">
          Like
        </button>
      </div>
      <p className="mt-2 text-center text-[11px] text-gray-400">{index + 1} of {deck.length} this week · {viewerKind === 'startup' ? 'investors' : 'startups'}</p>
    </div>
  );
}
