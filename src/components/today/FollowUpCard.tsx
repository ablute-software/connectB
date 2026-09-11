'use client';
// Prompt 884 — Follow up card: the two follow-up action_types that are NOT
// yet overdue (today-cards.ts's followUpTasks — due_at decides membership,
// never the subtitle below). "Last outreach on…" is purely informational,
// read straight off the most recent outbound interaction for the same
// entity/person — no helper for this existed yet (checked relationship.ts),
// so it's computed here rather than invented as a new store action.
import Link from 'next/link';
import { useState } from 'react';
import { Card, EntityLink } from '@/components/ui';
import { useStore } from '@/lib/store';
import { followUpTaskDisplayTitle, ACTION_TYPE_COLOR, ACTION_TYPE_LABEL } from '@/lib/relationship';
import type { Db, TaskItem } from '@/lib/types';

function lastOutreachDate(db: Db, t: TaskItem): string | undefined {
  const out = db.interactions
    .filter((i) => i.direction === 'out' && i.channel !== 'stage_change'
      && (t.entity_id ? i.entity_id === t.entity_id : false)
      && (t.person_id ? i.person_id === t.person_id : true))
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  return out[0]?.occurred_at.slice(0, 10);
}

export function FollowUpCard({ tasks, now }: { tasks: TaskItem[]; now: Date }) {
  const { db } = useStore();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <Card
      title={
        <button type="button" onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          Follow up ({tasks.length})
          <span className="text-xs text-gray-400">{collapsed ? '▸' : '▾'}</span>
        </button>
      }
    >
      {!collapsed && (
        tasks.length === 0 ? <p className="text-sm text-gray-400">No follow-ups pending.</p> : (
          <ul className="divide-y divide-gray-100">
            {tasks.map((t) => {
              const lastOutreach = lastOutreachDate(db, t);
              return (
                <li key={t.id} className="py-2 text-sm">
                  <div className="flex items-center gap-3">
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${ACTION_TYPE_COLOR[t.action_type]}`}>
                      {ACTION_TYPE_LABEL[t.action_type]}
                    </span>
                    <span className="flex-1">
                      {followUpTaskDisplayTitle(t, now)}
                      {t.entity_id && <> — <EntityLink id={t.entity_id}>{db.entities.find((e) => e.id === t.entity_id)?.name}</EntityLink></>}
                    </span>
                    {t.due_at && <span className="shrink-0 text-xs text-gray-400">{t.due_at.slice(0, 10)}</span>}
                    {t.entity_id && (
                      <Link href={`/entities/${t.entity_id}?rail=log&person=${t.person_id ?? ''}`}
                        className="shrink-0 rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white">
                        Reply now
                      </Link>
                    )}
                  </div>
                  {lastOutreach && <div className="ml-8 mt-0.5 text-xs text-gray-400">Last outreach on {lastOutreach}</div>}
                </li>
              );
            })}
          </ul>
        )
      )}
    </Card>
  );
}
