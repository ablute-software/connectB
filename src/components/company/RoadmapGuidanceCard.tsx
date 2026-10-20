'use client';
// The note at the top of the Roadmap tab when the roadmap is missing what investors look for (roadmap-guidance.ts decides what to say). Calm on purpose — it
// describes, it does not scold, and it disappears the moment the milestones exist. The add button is the founder's alone; a Developer Viewer reads the note.
import { GLASS_CARD } from './roadmap-visual';
import type { RoadmapGuidance } from '@/lib/roadmap-guidance';

export function RoadmapGuidanceCard({ guidance, onAdd }: { guidance: RoadmapGuidance; onAdd?: () => void }) {
  return (
    // id: the completeness bar's missing field is named roadmap.history; this is where it lands.
    <div role="note" id={guidance.needs.includes('history') ? 'roadmap.history' : undefined} className={`${GLASS_CARD} flex flex-wrap items-start justify-between gap-4 p-5`}>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold text-[#131b2e]">{guidance.title}</p>
        <p className="mt-1 text-sm text-[#434656]">{guidance.body}</p>
        {guidance.documentsHint && <p className="mt-2 text-xs text-[#434656]/80">{guidance.documentsHint}</p>}
      </div>
      {onAdd && (
        <button type="button" onClick={onAdd} className="shrink-0 rounded-lg bg-[#0041c8] px-3.5 py-2 text-xs font-medium text-white">
          {guidance.cta}
        </button>
      )}
    </div>
  );
}
