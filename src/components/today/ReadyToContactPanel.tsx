'use client';
// Prompt 398 §2 — extracted out of TodayPanel.tsx into its own top-level
// tab. Nuno's own feedback: Today is the page everything urgent routes
// through, and this list (N could run into the dozens) buried what was
// actually time-sensitive (Overdue, unclassified replies, interest
// requests) underneath it. Same JSX/logic as before, just moved — the
// `useReadyToContact` hook is also what tasks/page.tsx calls for the tab's
// own badge count, so the two can never disagree (same pattern
// useFounderActions/ActionsRequiredPanel already established).
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { Card, PersonLink, WaveTag } from '@/components/ui';
import { outboundCounts, preflight, preflightSummary } from '@/lib/rules';
import { recommendedActionType } from '@/lib/relationship';
import { ActionTypePill } from './TodayPanel';

export function useReadyToContact() {
  const { db } = useStore();
  const caps = outboundCounts(db);
  const capReached = caps.today >= caps.dailyCap || caps.week >= caps.weeklyCap;
  const ready = db.people
    .filter((p) => !p.do_not_contact)
    .filter((p) => {
      const e = db.entities.find((x) => x.id === p.entity_id);
      return e && ['not_contacted', 'contacted'].includes(e.status);
    })
    .filter((p) => preflightSummary(preflight(db, p, null)).green)
    .sort((a, b) => {
      const ea = db.entities.find((x) => x.id === a.entity_id); const eb = db.entities.find((x) => x.id === b.entity_id);
      return (ea?.wave ?? 9) - (eb?.wave ?? 9) || a.seniority_rank - b.seniority_rank;
    });
  return { ready, capReached, caps };
}

export function ReadyToContactPanel() {
  const { db } = useStore();
  const { ready, capReached, caps } = useReadyToContact();
  return (
    <Card title={<span className="text-green-700">Ready to contact ({capReached ? 0 : ready.length})</span>}>
      {capReached ? (
        <p className="text-sm text-gray-500">Daily cap reached ({caps.today}/{caps.dailyCap}). Queue resumes tomorrow — see Research needed in the meantime.</p>
      ) : ready.length === 0 ? (
        <p className="text-sm text-gray-400">No one is fully green right now — resolve pre-flight blockers or research hooks.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {ready.map((p) => {
            const e = db.entities.find((x) => x.id === p.entity_id)!;
            return (
              <li key={p.id} className="py-2 text-sm">
                <div className="flex items-center gap-2">
                  <WaveTag wave={e.wave} />
                  <ActionTypePill type={recommendedActionType(db, e.id, p.id)} />
                  <PersonLink id={p.id}><span className="font-medium">{p.full_name}</span></PersonLink>
                  <span className="text-gray-500">· {e.name}</span>
                  <Link href={`/log?entity=${e.id}&person=${p.id}`}
                    className="ml-auto rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white">Open draft flow</Link>
                </div>
                {p.hook && <div className="mt-0.5 text-xs text-gray-500">{p.hook}</div>}
                {e.submission_channel && <div className="text-xs text-cyan-800">Official channel first: {e.submission_channel}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
