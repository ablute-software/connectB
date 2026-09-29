'use client';
// Prompt 893 §A — "Committed by this investor" (entities.interest_eur),
// pulled out of the old Approach card (both surfaces had their own,
// slightly different, implementation) into one shared field for the
// Conversation tab. Kept as a plain "Current: X · Edit" line — a real
// input+Save UI exists too (the pre-893 full-dossier version) but
// window.prompt is the simpler of the two already-shipped
// implementations, and 893 doesn't ask for a redesign of this control,
// only a single new home for it.
import { useStore } from '@/lib/store';
import { fmtEur, TermHint } from '@/components/ui';
import type { Entity } from '@/lib/types';

export function CommittedAmountField({ entity }: { entity: Pick<Entity, 'id' | 'interest_eur'> }) {
  const { setInterest } = useStore();
  return (
    <div className="text-sm">
      <dt className="flex items-center text-xs text-gray-500">
        Committed by this investor
        <TermHint text="The amount THIS investor soft-circled or committed. It counts toward your round's progress on the dashboard." />
      </dt>
      <dd className="mt-1 text-xs text-gray-500">
        {entity.interest_eur == null
          ? <span className="text-gray-400">Doesn&apos;t apply yet — appears after a positive response.</span>
          : <>Current: {fmtEur(entity.interest_eur)}</>}
        <button
          onClick={() => {
            const v = window.prompt('Amount (€)', String(entity.interest_eur ?? ''));
            if (v !== null) setInterest(entity.id, v ? Number(v) : undefined);
          }}
          className="ml-2 text-cyan-700 hover:underline">
          Edit
        </button>
      </dd>
    </div>
  );
}
