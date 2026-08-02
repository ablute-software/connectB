'use client';
// Permanent first-milestone progress badge (onboarding_sherlockdeal_v2.md
// §5.4, pattern 3 — "barra de progresso permanente"). Deliberately NOT part
// of the onboarding engine (engine.ts/OnboardingProvider): no `seen` key, no
// dismiss, no session budget — it's always visible and recomputed live from
// `db`, same reasoning as pipeline.empty in pipeline/page.tsx.
//
// NOT the Profile Strength / companyCompleteness.ts weighted score — that's
// Phase 2, explicitly deferred until the matching engine gives its weights
// real meaning (prompt 35 §7). This is four simple yes/no milestones a
// founder clears in their first week ("W1"), chosen because each is already
// meaningful without any matching engine: profile basics filled, first
// investor in the pipeline, first outbound logged, Data Room ready to share.
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { FirstStepsPanel } from './FirstStepsPanel';

interface Milestone { key: string; label: string; done: boolean; href: string }

export function useW1Milestones(): Milestone[] {
  const { db } = useStore();
  return [
    {
      key: 'profile', label: 'Company profile', href: '/settings',
      done: !!(db.org.sector && db.org.stage && db.org.round_target_eur),
    },
    {
      key: 'pipeline', label: 'First investor', href: '/pipeline',
      done: db.entities.length > 0,
    },
    {
      key: 'outreach', label: 'First contact', href: '/tasks',
      done: db.interactions.length > 0,
    },
    {
      key: 'dataroom', label: 'Data room ready', href: '/documents',
      done: db.documents.length > 0,
    },
  ];
}

export function W1Badge() {
  const milestones = useW1Milestones();
  const done = milestones.filter((m) => m.done).length;
  // Prompt 85 Correction 2 — used to be a <Link> straight to the next
  // milestone's page, which read as "clicking this does nothing" to a
  // confused new user landing on an unexplained, still-empty page. Now
  // opens an in-place panel listing all 4 steps, their state, and an
  // action per incomplete one — the navigation still happens, just from
  // an explicit button inside the panel, not from the badge itself.
  const [open, setOpen] = useState(false);
  if (done === milestones.length) return null; // complete — nothing permanent left to nudge

  const next = milestones.find((m) => !m.done)!;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="hidden items-center gap-1.5 rounded-full border border-gray-100 bg-white px-3 py-1 text-xs text-gray-500 transition hover:border-gray-200 hover:text-gray-700 sm:flex"
        title={milestones.map((m) => `${m.done ? '✓' : '○'} ${m.label}`).join('  ·  ')}>
        <span className="font-medium text-[#0E7490]">First steps {done}/{milestones.length}</span>
        <span className="text-gray-300">·</span>
        <span>{next.label}</span>
      </button>
      {open && <FirstStepsPanel onClose={() => setOpen(false)} />}
    </>
  );
}
