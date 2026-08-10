'use client';
// Prompt 147 §4 — "See as they see it": read-only preview of the caller's
// own deck card, reusing CardFace exactly as the real deck renders it
// (same component, no second implementation of the card UI). No swipe, no
// drag — just the sub-card progress dots and a couple of buttons to step
// through slides, since this is a preview, not a functioning deck.
//
// Fetches its own copy of the profile row + (for a startup) pitch data,
// rather than reusing ProfilePanel's already-loaded state: ProfilePanel's
// local `Profile` interface is a narrower subset of the columns CardFace
// needs (no tam_eur/instruments/etc.), and this way the preview always
// reflects exactly what's saved, not an unsaved in-progress edit.
//
// Startup pitch data is fetched via direct client queries against orgs/
// company_people/org_traction_metrics — NOT the matchdeal_startup_pitch_data
// RPC that MatchDealDeck.tsx uses for other candidates' cards. That RPC
// (migration 0138) is gated to "caller currently holds an investor
// profile" — a startup previewing its OWN card never satisfies that, by
// design (the guard exists specifically to stop a startup reading a
// competitor's pitch). RLS already lets an org member read its own org's
// rows directly, so there's no need to route around the guard at all.
//
// Portal to document.body, same fix/reasoning as WelcomeModal.tsx/
// HelpSupportWidget.tsx (see CLAUDE.md's containing-block note): /pair's
// own container chain has nested flex-1s (just given min-h-0 in §1 of this
// same prompt) — rendering this fixed-inset overlay inline would silently
// break the moment any ancestor picks up a transform/filter/backdrop-filter,
// exactly the bug class §1 already found once in this app.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { browserClient } from '@/lib/supabase';
import { CardFace, subCardCountFor, type MatchDealProfile, type PitchData } from './MatchDealDeck';

type OwnProfileRow = MatchDealProfile & {
  membership_id: string | null;
  tam_eur: number | null; sam_eur: number | null; som_eur: number | null;
  revenue_projection_12mo_eur: number | null; revenue_projection_5yr_eur: number | null;
};

export function MiniPitchPreviewModal({ profileId, kind, onClose }: {
  profileId: string; kind: 'startup' | 'investor'; onClose: () => void;
}) {
  const [profile, setProfile] = useState<OwnProfileRow | null>(null);
  const [pitchData, setPitchData] = useState<PitchData | null>(null);
  const [subIndex, setSubIndex] = useState(0);
  const [slideDir, setSlideDir] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sb = browserClient();
      const { data: p } = await sb.from('matchdeal_profiles').select('*').eq('id', profileId).maybeSingle();
      if (cancelled || !p) return;
      const row = p as unknown as OwnProfileRow;
      setProfile(row);
      if (kind !== 'startup' || !row.membership_id) return;
      const [{ data: org }, { data: founders }, { data: traction }] = await Promise.all([
        sb.from('orgs').select('name, one_liner, description, country, hq_city, sectors, founded_year, round_target_eur, revenue_eur, logo_url, stage').eq('id', row.membership_id).maybeSingle(),
        sb.from('company_people').select('full_name, title, bio, photo_url').eq('org_id', row.membership_id).eq('is_founder', true).order('sort_order'),
        sb.from('org_traction_metrics').select('dealdigger_type, value, label').eq('org_id', row.membership_id).eq('show_on_dealdigger', true).order('sort_order'),
      ]);
      if (cancelled) return;
      setPitchData({
        org_name: org?.name ?? null, one_liner: org?.one_liner ?? null, description: org?.description ?? null,
        country: org?.country ?? null, hq_city: org?.hq_city ?? null, sectors: org?.sectors ?? [],
        founded_year: org?.founded_year ?? null, round_target_eur: org?.round_target_eur ?? null, revenue_eur: org?.revenue_eur ?? null,
        logo_url: org?.logo_url ?? null, stage: (org?.stage as string | null) ?? null,
        tam_eur: row.tam_eur, sam_eur: row.sam_eur, som_eur: row.som_eur,
        revenue_projection_12mo_eur: row.revenue_projection_12mo_eur, revenue_projection_5yr_eur: row.revenue_projection_5yr_eur,
        traction_metrics: (traction ?? []).map((t) => ({ type: t.dealdigger_type as string, value: t.value as string, label: (t.label as string) ?? undefined })),
        founders: (founders ?? []) as PitchData['founders'],
      });
    })();
    return () => { cancelled = true; };
  }, [profileId, kind]);

  const cardCount = subCardCountFor(kind);

  function step(dir: 1 | -1) {
    setSlideDir(dir === 1 ? 'up' : 'down');
    setSubIndex((s) => Math.min(Math.max(s + dir, 0), cardCount - 1));
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div role="dialog" aria-label="Preview your mini-pitch card" className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0B1220]/90 px-6 backdrop-blur-sm">
      <div className="flex w-full max-w-[340px] items-center justify-between pb-3">
        <p className="text-[13px] font-semibold text-white/80">This is how {kind === 'startup' ? 'investors' : 'startups'} see your card</p>
        <button type="button" onClick={onClose} aria-label="Close preview" className="rounded-full bg-white/10 px-2.5 py-1 text-[13px] text-white">✕</button>
      </div>
      <div className="relative aspect-[9/16] w-full max-w-[340px]">
        {profile ? (
          <CardFace p={profile} subIndex={subIndex} active pitchData={pitchData} slideDir={slideDir} />
        ) : (
          <div className="flex h-full w-full items-center justify-center rounded-[28px] bg-white/5">
            <p className="text-[13px] text-white/50">Loading preview…</p>
          </div>
        )}
      </div>
      <div className="mt-4 flex items-center gap-4">
        <button type="button" onClick={() => step(-1)} disabled={subIndex === 0}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-[16px] text-white disabled:opacity-30">◀</button>
        <span className="text-[12px] text-white/50">{subIndex + 1} / {cardCount}</span>
        <button type="button" onClick={() => step(1)} disabled={subIndex === cardCount - 1}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-[16px] text-white disabled:opacity-30">▶</button>
      </div>
    </div>,
    document.body,
  );
}
