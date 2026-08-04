'use client';
// Prompt 97 — MatchDeal bottom tab bar, 5 icons. Nuno's addenda (after seeing
// the "how do you get back to Discover" question expose a real navigation
// gap) reversed the original 4-icon plan: the swipe deck keeps its own
// icon, renamed "DealDigger", central and visually larger — same
// position/emphasis the 31/07 `bottomnav` decision already gave "Discover",
// only the label changes. Renaming does not touch the matching engine at
// all: matchdeal_eligible_deck's hard filters + rotation are untouched:
// this is a label and a footer position, nothing else.
import { useBottomNavRef } from '@/lib/bottom-nav-context';

const TABS = [
  { key: 'matches', label: 'Matches', icon: '🤝' },
  { key: 'messages', label: 'Instant Message', icon: '💬' },
  { key: 'deck', label: 'DealDigger', icon: '💎', central: true },
  { key: 'boost', label: 'Boost & Extra', icon: '🚀' },
  { key: 'profile', label: 'Profile', icon: '👤' },
] as const;

export type MatchDealTab = (typeof TABS)[number]['key'];

export function MatchDealTabBar({ active, onChange }: { active: MatchDealTab; onChange: (tab: MatchDealTab) => void }) {
  // Prompt 125 Block A — reports this bar's real rendered height (already
  // includes env(safe-area-inset-bottom) below) to ReportProblemWidget, so
  // the FAB stops landing on top of "Profile".
  const navRef = useBottomNavRef<HTMLElement>();
  return (
    <nav
      ref={navRef}
      className="relative z-10 flex shrink-0 items-end justify-around border-t border-white/10 bg-[#0B1220]/95 px-1 pt-1.5 backdrop-blur-xl"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 6px)' }}
      aria-label="MatchDeal navigation"
    >
      {TABS.map((tab) => {
        const isActive = active === tab.key;
        if ('central' in tab && tab.central) {
          return (
            <button
              key={tab.key} type="button" onClick={() => onChange(tab.key)}
              aria-current={isActive ? 'page' : undefined}
              className="relative -mt-5 flex flex-col items-center gap-1 px-2"
            >
              <span
                className={`flex h-14 w-14 items-center justify-center rounded-full text-[26px] shadow-lg transition ${
                  isActive
                    ? 'bg-gradient-to-br from-blue-500 via-emerald-500 to-orange-400 scale-105'
                    : 'bg-gradient-to-br from-blue-500/70 via-emerald-500/70 to-orange-400/70'
                }`}
              >
                {tab.icon}
              </span>
              <span className={`text-[10px] font-semibold ${isActive ? 'text-white' : 'text-white/50'}`}>{tab.label}</span>
            </button>
          );
        }
        return (
          <button
            key={tab.key} type="button" onClick={() => onChange(tab.key)}
            aria-current={isActive ? 'page' : undefined}
            className="flex flex-col items-center gap-1 px-2 py-1.5"
          >
            <span className={`text-[19px] leading-none ${isActive ? 'opacity-100' : 'opacity-50'}`}>{tab.icon}</span>
            <span className={`text-[10px] font-semibold leading-none ${isActive ? 'text-white' : 'text-white/50'}`}>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
