'use client';
// Prompt 601 §D — the founder's own platform statuses, in two places:
//   'plans' — Plans & Billing, at the top, with the right spelled out
//             ("free forever while…", "25% off, forever") so whoever holds
//             the status understands what they have without asking;
//   'about' — about [company], its own card, visibly separate from
//             "Badges & awards" (the company's verified awards, which ARE
//             shown to investors — these never are).
// An org with no status renders nothing at all (§ verification, last line).
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';
import { PlatformBadgeIcon } from './PlatformBadgeIcon';
import { formatDate, type PlatformBadgeKey } from '@/lib/platform-badges';

interface BadgeView {
  badge: PlatformBadgeKey; label: string; rights: string; grantedAt: string | null; freeUntil: string | null;
  discountPct: number | null; sedulousCount: number; lapsed: boolean;
  window: { elapsedPct: number; daysLeft: number; deadlineAt: string; lastUse: string | null; warning: boolean } | null;
}

export function PlatformStatusCard({ variant, onLoaded }: { variant: 'plans' | 'about'; onLoaded?: (freeTier: string | null) => void }) {
  const [badges, setBadges] = useState<BadgeView[] | null>(null);

  useEffect(() => {
    fetch('/api/platform-badges', { cache: 'no-store' }).then((r) => r.json()).then((body) => {
      if (body.ok) { setBadges(body.badges ?? []); onLoaded?.(body.freeTier ?? null); }
      else setBadges([]);
    }).catch(() => setBadges([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!badges || badges.length === 0) return null;

  return (
    <Card title={variant === 'plans' ? 'Your Sherlock status' : 'Sherlock status'} tint="blue">
      <ul className="space-y-3">
        {badges.map((b) => (
          <li key={b.badge} className="flex items-start gap-3">
            <PlatformBadgeIcon badge={b.badge} size={variant === 'plans' ? 40 : 32} count={b.sedulousCount} title={b.label} className="mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-bold text-gray-900">{b.label}</span>
                {b.badge === 'sedulous' && <span className="text-xs text-gray-500">× {b.sedulousCount}</span>}
                {b.lapsed && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">under review</span>}
              </div>
              <p className="text-sm text-gray-800">{b.rights}</p>
              {b.window && variant === 'plans' && (
                <p className={`mt-0.5 text-xs ${b.lapsed ? 'text-amber-800' : b.window.warning ? 'text-amber-700' : 'text-gray-500'}`}>
                  {b.lapsed
                    ? 'The 2-month window passed without a use. Nothing is charged and nothing was revoked — using Sherlock restores the status.'
                    : <>
                        {b.window.lastUse ? `Last use ${formatDate(b.window.lastUse)}` : 'No use recorded since the status was granted'}
                        {' · '}{b.window.daysLeft} day{b.window.daysLeft === 1 ? '' : 's'} left in the current window (until {formatDate(b.window.deadlineAt)})
                      </>}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
      {variant === 'about' && (
        <p className="mt-3 text-[11px] text-gray-500">
          Platform statuses are between you and Sherlock — they are never shown to investors. The verified badges and awards below are.
        </p>
      )}
    </Card>
  );
}
