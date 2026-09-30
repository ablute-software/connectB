'use client';
// Prompt 893 §A — "Committed by this investor" (entities.interest_eur),
// pulled out of the old Approach card into one shared field for the
// Conversation tab.
//
// Prompt 894 §A — the window.prompt Edit button is GONE: this field is no
// longer a free-standing editable value. entities.interest_eur is now
// DERIVED (a DB trigger sets it from the latest non-superseded
// deal_terms row of kind='commitment' — see src/lib/deal-terms.ts and
// migration 20260930105448_deal_terms.sql), so editing it directly here
// would just get silently overwritten the next time a commitment term is
// written. The real editing surface is Terms on the table's own
// "+ Add term -> Commitment", rendered right below this field in both
// dossier surfaces (TermsOnTheTable.tsx) — this component is now a plain,
// read-only display of the derived value with a pointer to where to
// actually change it.
import { fmtEur, TermHint } from '@/components/ui';
import type { Entity } from '@/lib/types';

export function CommittedAmountField({ entity }: { entity: Pick<Entity, 'id' | 'interest_eur'> }) {
  return (
    <div className="text-sm">
      <dt className="flex items-center text-xs text-gray-500">
        Committed by this investor
        <TermHint text="The amount THIS investor soft-circled or committed — derived from the latest agreed Commitment term below. It counts toward your round's progress on the dashboard." />
      </dt>
      <dd className="mt-1 text-xs text-gray-500">
        {entity.interest_eur == null
          ? <span className="text-gray-400">Doesn&apos;t apply yet — add a Commitment term below once one exists.</span>
          : <>Current: {fmtEur(entity.interest_eur)} <span className="text-gray-400">· see Terms on the table below to change it</span></>}
      </dd>
    </div>
  );
}
