'use client';
// IRM_SPEC §6b — subtle completeness display + founder-side "Request more
// info," which just increments demand in the back-office enrichment queue
// (§6b-2) by writing a marked contributions row. Reuses the contributions
// table rather than adding a dedicated one for a single boolean signal.
import { useState } from 'react';
import { authEnabled, browserClient } from '@/lib/supabase';
import { ENRICHMENT_THRESHOLD, ENRICHMENT_REQUEST_FIELD, type CompletenessResult } from '@/lib/completeness';

export function EnrichmentBadge({ result, subjectType, subjectId, orgId }: {
  result: CompletenessResult; subjectType: 'entity' | 'person'; subjectId: string; orgId: string;
}) {
  const [requested, setRequested] = useState(false);
  const low = result.percent < ENRICHMENT_THRESHOLD;

  async function requestMoreInfo() {
    if (!authEnabled) return;
    await browserClient().from('contributions').insert({
      subject_type: subjectType, subject_id: subjectId, org_id: orgId,
      field: ENRICHMENT_REQUEST_FIELD, value: true, note: `Missing: ${result.missing.join(', ')}`,
    });
    setRequested(true);
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-400" title={result.missing.length ? `Missing: ${result.missing.join(', ')}` : 'Complete'}>
      <span className={low ? 'text-amber-600' : 'text-gray-400'}>Profile {result.percent}% complete</span>
      {low && authEnabled && (
        requested
          ? <span className="text-gray-400">— requested</span>
          : <button onClick={requestMoreInfo} className="text-[#0E7490] hover:underline">Request more info</button>
      )}
    </span>
  );
}
