'use client';
// IRM_SPEC §4b — Relationship summary card. Compact chip for the pipeline row;
// full stage stepper + one-liner + CTAs for the entity page header.
import type { ReactNode } from 'react';
import Link from 'next/link';
import type { Entity } from '@/lib/types';
import { useStore } from '@/lib/store';
import { STAGE_ORDER, STAGE_LABEL, relationshipSummary, nextBestAction, type WhoseTurn, type Health } from '@/lib/relationship';
import { LOCK_DAYS } from '@/lib/rules';
import { TermHint } from '@/components/ui';

// Prompt 49 §4 — jargon inside nextBestAction()'s free-text copy gets a
// clickable (i) the first time it appears in the string. First-match-only
// (not global): these are short one-liners, a single term is what's ever
// actually present, and replacing every occurrence would need a much less
// readable regex-split-map dance for no real benefit today.
const NEXT_STEP_GLOSSARY: { pattern: RegExp; explain: string }[] = [
  { pattern: /pre-flight/i, explain: 'An automatic check run just before a first message — flags missing hook research, banned phrases, or reaching out too soon.' },
  { pattern: /^Locked/, explain: `Outreach to this investor is paused for ${LOCK_DAYS} days after your last message, so a reply has time to arrive before you follow up again.` },
];

function annotateNextStep(text: string): ReactNode {
  for (const term of NEXT_STEP_GLOSSARY) {
    const m = text.match(term.pattern);
    if (m?.index === undefined) continue;
    const before = text.slice(0, m.index);
    const match = m[0];
    const after = text.slice(m.index + match.length);
    return <>{before}{match}<TermHint text={term.explain} />{after}</>;
  }
  return text;
}

const WHOSE_TURN_STYLE: Record<WhoseTurn, string> = {
  us: 'bg-cyan-100 text-cyan-900',
  them: 'bg-blue-100 text-blue-900',
  overdue: 'bg-red-100 text-[#B00000]',
  none: 'bg-gray-100 text-gray-400',
};
const WHOSE_TURN_LABEL: Record<WhoseTurn, string> = {
  us: 'We owe a reply', them: 'Waiting on them', overdue: 'Overdue', none: 'No contact yet',
};

const HEALTH_DOT: Record<Health, string> = {
  hot: 'bg-[#B00000]', warm: 'bg-green-600', stalled: 'bg-gray-400', none: '',
};
const HEALTH_LABEL: Record<Health, string> = {
  hot: 'Hot — meeting or diligence', warm: 'Warm — recent activity', stalled: 'Stalled — no movement in a while', none: '',
};

export function HealthDot({ entityId }: { entityId: string }) {
  const { db } = useStore();
  const s = relationshipSummary(db, entityId);
  if (s.health === 'none') return null;
  return <span title={HEALTH_LABEL[s.health]} className={`inline-block h-2 w-2 rounded-full ${HEALTH_DOT[s.health]}`} />;
}

export function WhoseTurnChip({ entityId }: { entityId: string }) {
  const { db } = useStore();
  const s = relationshipSummary(db, entityId);
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${WHOSE_TURN_STYLE[s.whoseTurn]}`}>
      {WHOSE_TURN_LABEL[s.whoseTurn]}
    </span>
  );
}

// Compact version for the pipeline row — a whose-turn chip + one-line status.
export function RelationshipCompactLine({ entityId }: { entityId: string }) {
  const { db } = useStore();
  const s = relationshipSummary(db, entityId);
  if (s.touchCount === 0) return null;
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-400">
      <HealthDot entityId={entityId} />
      <WhoseTurnChip entityId={entityId} />
      <span>
        Last touch {s.lastTouchAt?.slice(0, 10)} ({s.daysSinceLastTouch}d) · {s.touchCount} touch{s.touchCount === 1 ? '' : 'es'}
      </span>
    </div>
  );
}

// Full version for the entity page header.
export function RelationshipSummaryCard({ entity, onOpenThread }: { entity: Entity; onOpenThread?: () => void }) {
  const { db } = useStore();
  const s = relationshipSummary(db, entity.id);
  const action = nextBestAction(db, entity.id);
  const currentIdx = STAGE_ORDER.indexOf(s.stage);

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {STAGE_ORDER.map((stg, i) => (
          <div key={stg} className="flex items-center gap-1">
            <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium ${
              i === currentIdx ? 'bg-[#0E7490] text-white'
                : i < currentIdx ? 'bg-[#E8F4F8] text-cyan-900'
                : 'bg-gray-100 text-gray-400'}`}>
              {STAGE_LABEL[stg]}
            </span>
            {i < STAGE_ORDER.length - 1 && <span className="text-gray-300">→</span>}
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-gray-600">
        <HealthDot entityId={entity.id} />
        <WhoseTurnChip entityId={entity.id} />
        <span>
          {s.firstContactAt ? `First contact ${s.firstContactAt.slice(0, 10)}` : 'No contact yet'}
          {s.lastTouchAt && s.lastTouchAt !== s.firstContactAt && ` · Last touch ${s.lastTouchAt.slice(0, 10)} (${s.daysSinceLastTouch}d ago)`}
          {s.touchCount > 0 && ` · ${s.touchCount} touch${s.touchCount === 1 ? '' : 'es'}`}
        </span>
      </div>
      {action && <div className="mt-1.5 text-xs font-medium text-[#0E7490]">Next: {annotateNextStep(action)}</div>}

      <div className="mt-3 flex gap-2">
        {onOpenThread && (
          <button onClick={onOpenThread} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">
            Open thread
          </button>
        )}
        <Link href={`/log?entity=${entity.id}`} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white">
          Log interaction
        </Link>
      </div>
    </div>
  );
}
