'use client';
// Prompt 884 — Other card: whatever's left after Meetings/Overdue/Follow up
// (today-cards.ts's otherTasks, computed by exclusion so nothing is
// double-counted or dropped between the four cards). No priority field
// exists on `tasks` — otherTaskPriority derives an honest signal from the
// linked entity's own fit_score and returns undefined (no pill) rather than
// inventing one for a task with no entity or an unscored entity.
import Link from 'next/link';
import { useState } from 'react';
import { Card, EntityLink } from '@/components/ui';
import { useStore } from '@/lib/store';
import { followUpTaskDisplayTitle, ACTION_TYPE_COLOR, ACTION_TYPE_LABEL } from '@/lib/relationship';
import { otherTaskPriority } from '@/lib/today-cards';
import type { TaskItem } from '@/lib/types';

const PRIORITY_COLOR: Record<'High' | 'Medium' | 'Low', string> = {
  High: 'bg-red-50 text-[#B00000]', Medium: 'bg-amber-50 text-amber-700', Low: 'bg-gray-100 text-gray-500',
};

export function OtherCard({ tasks, now }: { tasks: TaskItem[]; now: Date }) {
  const { db, toggleTask } = useStore();
  const [collapsed, setCollapsed] = useState(true);

  return (
    <Card
      title={
        <button type="button" onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          Other ({tasks.length})
          <span className="text-xs text-gray-400">{collapsed ? '▸' : '▾'}</span>
        </button>
      }
    >
      {!collapsed && (
        tasks.length === 0 ? <p className="text-sm text-gray-400">Nothing else pending.</p> : (
          <ul className="divide-y divide-gray-100">
            {tasks.map((t) => {
              const priority = otherTaskPriority(t, db.entities);
              return (
                <li key={t.id} className="flex items-center gap-3 py-2 text-sm">
                  <input type="checkbox" checked={false} onChange={() => toggleTask(t.id)} />
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${ACTION_TYPE_COLOR[t.action_type]}`}>
                    {ACTION_TYPE_LABEL[t.action_type]}
                  </span>
                  <span className="flex-1 truncate">
                    {followUpTaskDisplayTitle(t, now)}
                    {t.entity_id && <> — <EntityLink id={t.entity_id}>{db.entities.find((e) => e.id === t.entity_id)?.name}</EntityLink></>}
                  </span>
                  {priority && <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${PRIORITY_COLOR[priority]}`}>{priority}</span>}
                  {t.due_at && <span className="shrink-0 text-xs text-gray-400">{t.due_at.slice(0, 10)}</span>}
                </li>
              );
            })}
          </ul>
        )
      )}
    </Card>
  );
}
