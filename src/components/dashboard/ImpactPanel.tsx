'use client';
// Prompt 361 — the Dashboard's third sub-tab: a founder-only, mechanical
// (no AI) comparison of the campaign before vs. with Sherlock. Root privacy
// rule (CLAUDE.md) — this is founder-private performance data end to end;
// none of it is wired into company-knowledge.ts or any investor-visible
// surface, and nothing here ever will be.
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui';
import {
  funnelByEra, velocityByEra, impactSentence, smallNumbersGuard, platformAgeDays,
  type EraFunnel,
} from '@/lib/dashboard-era';

const FUNNEL_LABELS: { key: keyof EraFunnel; label: string }[] = [
  { key: 'contacted', label: 'Contacted' }, { key: 'replied', label: 'Replied' },
  { key: 'meeting', label: 'Meeting' }, { key: 'diligence', label: 'Diligence' }, { key: 'committed', label: 'Committed' },
];

// Prompt 361 §"só possível com o Sherlock" — signals with literally no
// pre-platform equivalent: MatchDeal/catalog brought the entity in, or the
// activity is a platform-native surface with no import path at all. Two of
// the four (interest requests, watchers) need their own fetch — they live
// outside the per-org `Db` shape (see InvestorEngagementCards' own fetches
// for the same reason) — and both degrade to an empty list rather than an
// error in demo mode (no real session to authenticate).
interface OnlyPossibleRow { label: string; count: number; firstAt?: string }

function useOnlyPossibleWithSherlock() {
  const { db } = useStore();
  const [interestCount, setInterestCount] = useState<{ count: number; firstAt?: string }>({ count: 0 });
  const [watchCount, setWatchCount] = useState<{ count: number; firstAt?: string }>({ count: 0 });

  useEffect(() => {
    fetch('/api/founder/interest-level-requests').then((r) => r.json()).then((d) => {
      const rows: { requestedAt: string }[] = d.requests ?? [];
      if (rows.length === 0) return;
      const dates = rows.map((r) => r.requestedAt).sort();
      setInterestCount({ count: rows.length, firstAt: dates[0] });
    }).catch(() => {});
    fetch('/api/founder/watches').then((r) => r.json()).then((d) => {
      const rows: { requestedAt: string }[] = d.watchers ?? [];
      if (rows.length === 0) return;
      const dates = rows.map((r) => r.requestedAt).sort();
      setWatchCount({ count: rows.length, firstAt: dates[0] });
    }).catch(() => {});
  }, []);

  const matchDealEntities = db.entities.filter((e) => e.source === 'match_deal' || e.source === 'catalog');
  const matchDealDates = matchDealEntities.map((e) => e.created_at).filter(Boolean).sort() as string[];
  const views = db.views;
  const viewDates = views.map((v) => v.viewed_at).sort();

  const rows: OnlyPossibleRow[] = [
    { label: 'Investors sourced via MatchDeal/catalog', count: matchDealEntities.length, firstAt: matchDealDates[0] },
    { label: 'Interest level requests received', count: interestCount.count, firstAt: interestCount.firstAt },
    { label: 'Investors watching your data room', count: watchCount.count, firstAt: watchCount.firstAt },
    { label: 'Data room views', count: views.length, firstAt: viewDates[0] },
  ];
  return rows.filter((r) => r.count > 0);
}

function FunnelRow({ label, before, platform, max }: { label: string; before: number; platform: number; max: number }) {
  return (
    <div className="grid items-center gap-2 text-xs" style={{ gridTemplateColumns: '5.5rem 1fr 1fr' }}>
      <span className="text-gray-500">{label}</span>
      <div className="flex items-center gap-1.5">
        <div className="h-3 rounded bg-gray-300" style={{ width: `${Math.max(4, before / max * 100)}%` }} />
        <span className="font-medium text-gray-600">{before}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="h-3 rounded bg-[#0E7490]" style={{ width: `${Math.max(4, platform / max * 100)}%` }} />
        <span className="font-medium text-[#0E7490]">{platform}</span>
      </div>
    </div>
  );
}

export function ImpactPanel() {
  const { db } = useStore();
  const joinedAt = db.org.created_at ?? null;
  const now = new Date();
  const ageDays = platformAgeDays(joinedAt, now);

  const before = funnelByEra(db, 'before', joinedAt);
  const platform = funnelByEra(db, 'platform', joinedAt);
  const guarded = smallNumbersGuard(ageDays, before.contacted, platform.contacted, before.replied, platform.replied);

  const beforeVelocity = velocityByEra(db, 'before', joinedAt, now);
  const platformVelocity = velocityByEra(db, 'platform', joinedAt, now);

  const onlyPossible = useOnlyPossibleWithSherlock();

  const maxFunnel = Math.max(1, before.contacted, platform.contacted);

  if (!joinedAt) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-bold">Impact</h1>
        <p className="text-sm text-gray-400">No join date on file yet — the before/with Sherlock comparison needs one to split your history.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Impact</h1>
      <p className="text-xs text-gray-400">Founder-only. Never shown to investors, never used to generate anything investor-visible.</p>

      <Card>
        <p className="text-sm text-gray-800">{impactSentence(before, platform, guarded)}</p>
      </Card>

      <Card title="Funnel — before vs. with Sherlock">
        <div className="mb-2 grid gap-2 text-[10px] font-semibold text-gray-400" style={{ gridTemplateColumns: '5.5rem 1fr 1fr' }}>
          <span />
          <span>BEFORE</span>
          <span className="text-[#0E7490]">WITH SHERLOCK</span>
        </div>
        <div className="space-y-1.5">
          {FUNNEL_LABELS.map(({ key, label }) => (
            <FunnelRow key={key} label={label} before={before[key]} platform={platform[key]} max={maxFunnel} />
          ))}
        </div>
        {!guarded && before.contacted > 0 && platform.contacted > 0 && (
          <p className="mt-2 text-[11px] text-gray-400">
            Reply rate: {Math.round(before.replied / before.contacted * 100)}% before → {Math.round(platform.replied / platform.contacted * 100)}% with Sherlock.
          </p>
        )}
      </Card>

      <Card title="Velocity">
        {guarded ? (
          <p className="text-sm text-gray-400">Early days — comparisons firm up as activity accumulates.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold text-gray-500">Before Sherlock <span className="font-normal text-gray-400">({beforeVelocity.periodLabel})</span></p>
              <p className="mt-1 text-sm text-gray-700">{beforeVelocity.contactsPerMonth.toFixed(1)} contacts/mo · {beforeVelocity.repliesPerMonth.toFixed(1)} replies/mo · {beforeVelocity.meetingsPerMonth.toFixed(1)} meetings/mo</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-[#0E7490]">With Sherlock <span className="font-normal text-gray-400">({platformVelocity.periodLabel})</span></p>
              <p className="mt-1 text-sm text-gray-700">{platformVelocity.contactsPerMonth.toFixed(1)} contacts/mo · {platformVelocity.repliesPerMonth.toFixed(1)} replies/mo · {platformVelocity.meetingsPerMonth.toFixed(1)} meetings/mo</p>
            </div>
          </div>
        )}
      </Card>

      <Card title="Only possible with Sherlock">
        {onlyPossible.length === 0 ? (
          <p className="text-sm text-gray-400">Nothing yet from platform-native activity — this fills in as investors interact with your data room, request access, or watch your progress.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {onlyPossible.map((r) => (
              <li key={r.label} className="flex items-center justify-between gap-2">
                <span>{r.label}</span>
                <span className="text-xs text-gray-500">{r.count}{r.firstAt ? ` · first ${r.firstAt.slice(0, 10)}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
