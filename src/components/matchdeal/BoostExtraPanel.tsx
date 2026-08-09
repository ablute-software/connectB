'use client';
// Prompt 143 — matchdeal_activate_super_like / matchdeal_boosts already
// exist and work end-to-end at the DB layer (found live while surveying
// this prompt); this replaces the stub with the real read side. Weekly
// used/available reuses matchdeal_weekly_quota_status for the
// authoritative week_start (never reimplements Postgres's ISO-week
// boundary in JS), then reads matchdeal_weekly_activity.super_like_used_at
// directly — RLS (matchdeal_weekly_activity_own) already lets an owner
// read their own row.
//
// Migration 0153 (2026-08-09, same-day bug hunt, found and applied
// directly by Nuno) revoked direct SELECT on matchdeal_boosts entirely —
// the original matchdeal_boosts_participants RLS let a boosted startup
// read investor_profile_id straight off the row, breaking §15.4 ("a
// startup sabe que recebeu, nao sabe de quem"). matchdeal_my_boosts() is
// the replacement: one RPC, masks investor_profile_id to null for the
// boosted side, real value for the investor side. A single call now
// covers both branches below — an investor caller can never appear as
// boosted_profile_id (matchdeal_activate_super_like only ever inserts
// investor->startup), so every row returned to an investor IS one they
// gave; every row returned to a startup IS one they received, already
// anonymised server-side.
import { useEffect, useState } from 'react';
import { browserClient } from '@/lib/supabase';

interface MyBoostRow { id: string; boosted_profile_id: string; investor_profile_id: string | null; created_at: string }

export function BoostExtraPanel({ viewerProfileId, viewerKind }: { viewerProfileId: string; viewerKind: 'startup' | 'investor' }) {
  const [used, setUsed] = useState<boolean | null>(null);
  const [given, setGiven] = useState<{ id: string; name: string | null; createdAt: string }[] | null>(null);
  const [receivedCount, setReceivedCount] = useState<number | null>(null);

  useEffect(() => {
    const sb = browserClient();
    let cancelled = false;
    (async () => {
      const { data: quota } = await sb.rpc('matchdeal_weekly_quota_status', { p_viewer_profile_id: viewerProfileId });
      const weekStart = (quota as { week_start: string }[] | null)?.[0]?.week_start;
      if (weekStart) {
        const { data: weekly } = await sb.from('matchdeal_weekly_activity')
          .select('super_like_used_at').eq('profile_id', viewerProfileId).eq('week_start', weekStart).maybeSingle();
        if (!cancelled) setUsed(!!weekly?.super_like_used_at);
      } else if (!cancelled) {
        setUsed(false);
      }

      const { data: boostRows } = await sb.rpc('matchdeal_my_boosts');
      const rows = (boostRows ?? []) as MyBoostRow[];

      if (viewerKind === 'investor') {
        const boostedIds = [...new Set(rows.map((r) => r.boosted_profile_id))];
        let names = new Map<string, string | null>();
        if (boostedIds.length > 0) {
          const { data: profiles } = await sb.from('matchdeal_profiles').select('id, entity_name').in('id', boostedIds);
          names = new Map((profiles ?? []).map((p) => [p.id as string, p.entity_name as string | null]));
        }
        if (!cancelled) {
          setGiven([...rows].sort((a, b) => b.created_at.localeCompare(a.created_at))
            .map((r) => ({ id: r.id, name: names.get(r.boosted_profile_id) ?? null, createdAt: r.created_at })));
        }
      } else if (!cancelled) {
        setReceivedCount(rows.length);
      }
    })();
    return () => { cancelled = true; };
  }, [viewerProfileId, viewerKind]);

  return (
    <div className="flex-1 overflow-y-auto px-5 py-6 text-white">
      <h1 className="text-[17px] font-bold">Boost & Extra</h1>

      <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/50">This week</p>
        <p className="mt-1 text-[14px] leading-snug text-white/90">
          {used === null ? 'Loading…' : used
            ? 'Your weekly Boost is used.'
            : 'Your weekly Boost is available — swipe down (or tap 🚀) on a card in the deck to use it.'}
        </p>
      </div>

      {viewerKind === 'investor' ? (
        <div className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/50">Boosted by you</p>
          {given === null ? (
            <p className="mt-1.5 text-[13px] text-white/50">Loading…</p>
          ) : given.length === 0 ? (
            <p className="mt-1.5 text-[13px] text-white/50">You haven&apos;t boosted anyone yet.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {given.map((b) => (
                <li key={b.id} className="flex items-center justify-between text-[13px] text-white/85">
                  <span>{b.name ?? 'A startup'}</span>
                  <span className="text-white/40">{new Date(b.createdAt).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/50">Boosts received</p>
          <p className="mt-1.5 text-[13px] text-white/85">
            {receivedCount === null ? 'Loading…' : receivedCount === 0
              ? 'No boosts yet.'
              : `${receivedCount} boost${receivedCount === 1 ? '' : 's'} — who gave them stays anonymous.`}
          </p>
        </div>
      )}

      <p className="mt-6 text-[12px] leading-relaxed text-white/40">
        1 Boost per week, available on the List of Suspects plan and above — using it also counts as a Like on that profile.
      </p>
    </div>
  );
}
