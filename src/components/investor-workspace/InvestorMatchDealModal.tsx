'use client';
// Investor Workspace — MatchDeal entry point (Prompt 74 Bloco 1). Same
// system as the founder's MatchDealModal.tsx, roles inverted: an investor's
// matchdeal_profiles(kind='investor') row is read here, not created — the
// matchdeal-pair Edge Function only knows how to import a STARTUP profile
// from org_members/Company tab (hard-coded kind:'startup', looked up via
// org_members), so it has no path for an investor identity at all. An
// investor's profile is already linked by the MatchDeal mobile app itself
// (matchdeal_investor_members.user_id) before this modal ever runs — there
// is nothing for a web pairing code to do here. Building a second pairing
// mechanism was explicitly out of scope, so this modal is read-only status,
// not a "Connect" flow.
import { useEffect, useState } from 'react';
import { browserClient } from '@/lib/supabase';

type LinkState = 'loading' | 'linked' | 'not_linked' | 'error';

export function InvestorMatchDealModal({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<LinkState>('loading');
  const [firmName, setFirmName] = useState<string | null>(null);

  useEffect(() => {
    const sb = browserClient();
    // matchdeal_my_profile() already resolves "whichever profile the
    // current auth.uid() owns" (startup or investor) — reused as-is rather
    // than re-deriving the membership_id join client-side.
    sb.rpc('matchdeal_my_profile').then(({ data, error }) => {
      if (error) { setState('error'); return; }
      if (data && data.kind === 'investor') {
        setFirmName((data.entity_name as string | null) ?? null);
        setState('linked');
      } else {
        setState('not_linked');
      }
    });
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-base font-semibold text-gray-800">🤝 MatchDeal</h2>
          <button onClick={onClose} className="text-sm text-gray-400 hover:text-gray-700">✕</button>
        </div>

        {state === 'loading' && <p className="mt-3 text-sm text-gray-400">Checking status…</p>}

        {state === 'linked' && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
            <span>✓</span>
            <span>MatchDeal is connected{firmName ? ` as ${firmName}` : ''}. Swipe on startups from the MatchDeal app — a mutual match shows up here automatically, in Pipeline.</span>
          </div>
        )}

        {(state === 'not_linked' || state === 'error') && (
          <>
            <p className="mt-3 text-sm text-gray-600">
              MatchDeal is a swipe-based matching app — a companion to this Pipeline. A mutual
              match with a startup moves straight to sharing their data room with you.
            </p>
            <p className="mt-2 text-xs text-gray-500">
              Your investor profile isn&apos;t linked to this Sherlock Deal account yet. Open the
              MatchDeal app, go to <b>Settings → Connect Sherlock Deal account</b>, and sign in with
              this same email — the same way it already works for founders, just from the
              investor side of the app.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
