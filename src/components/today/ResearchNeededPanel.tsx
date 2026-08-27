'use client';
// Prompt 398 §2 — extracted out of TodayPanel.tsx into its own top-level
// tab, same rationale as ReadyToContactPanel.tsx right next to it.
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { Card, PersonLink } from '@/components/ui';
import { ActionTypePill } from './TodayPanel';

export function useResearchNeeded() {
  const { db } = useStore();
  const research = db.tasks.filter((t) => !t.done && t.kind === 'research')
    .sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? ''));
  return { research };
}

export function ResearchNeededPanel() {
  const { toggleTask } = useStore();
  const { research } = useResearchNeeded();
  // Prompt 398 §1 — same undo pattern as TodayPanel's own checkbox (the
  // "any checkbox that uses the same gesture" instruction), its own local
  // state here since this now lives on a separate tab.
  const [undoable, setUndoable] = useState<{ taskId: string; label: string } | null>(null);
  function completeTask(taskId: string, label: string) {
    toggleTask(taskId);
    setUndoable({ taskId, label });
    window.setTimeout(() => setUndoable((u) => (u?.taskId === taskId ? null : u)), 10_000);
  }

  return (
    <div className="space-y-4">
      {undoable && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
          <span>Task completed — {undoable.label}</span>
          <button onClick={() => { toggleTask(undoable.taskId); setUndoable(null); }}
            className="font-semibold text-[#0E7490] hover:underline">
            Undo
          </button>
        </div>
      )}
      <Card title={<span className="text-[#0E7490]">Research needed ({research.length})</span>}>
        {research.length === 0 ? <p className="text-sm text-gray-400">No research tasks.</p> : (
          <ul className="divide-y divide-gray-100">
            {research.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2 text-sm">
                <input type="checkbox" checked={false} onChange={() => completeTask(t.id, t.title)} />
                <ActionTypePill type={t.action_type} />
                <span className="flex-1">{t.title}</span>
                {t.person_id && <PersonLink id={t.person_id}>open</PersonLink>}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-gray-400">No hook = no message. Generic messages burn contacts permanently.</p>
      </Card>
    </div>
  );
}
