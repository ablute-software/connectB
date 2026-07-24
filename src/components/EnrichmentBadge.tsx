'use client';
// IRM_SPEC §6b — subtle completeness display + founder-side "Request more
// info." Always records demand in the back-office enrichment queue (§6b-2)
// via a marked contributions row. For entities, it ALSO now triggers a real,
// on-demand web-lookup enrichment (src/app/api/entities/[id]/enrich) — the
// fix for what used to be a silent no-op stub (see DECISIONS.md). Person
// enrichment is unchanged (demand-flag only) — no lookup exists for people yet.
import { useState } from 'react';
import { authEnabled, browserClient } from '@/lib/supabase';
import { ENRICHMENT_THRESHOLD, ENRICHMENT_REQUEST_FIELD, type CompletenessResult } from '@/lib/completeness';

type LookupState = 'idle' | 'searching' | 'not_configured' | 'no_findings' | 'found' | 'error';

export function EnrichmentBadge({ result, subjectType, subjectId, orgId, onEnriched }: {
  result: CompletenessResult; subjectType: 'entity' | 'person'; subjectId: string; orgId: string;
  // Called once a lookup finds and stores at least one suggestion, so the
  // caller can refresh whatever list is showing pending contributions.
  onEnriched?: () => void;
}) {
  const [requested, setRequested] = useState(false);
  const [lookup, setLookup] = useState<LookupState>('idle');
  const low = result.percent < ENRICHMENT_THRESHOLD;

  async function requestMoreInfo() {
    if (!authEnabled) return;
    await browserClient().from('contributions').insert({
      subject_type: subjectType, subject_id: subjectId, org_id: orgId,
      field: ENRICHMENT_REQUEST_FIELD, value: true, note: `Missing: ${result.missing.join(', ')}`,
    });
    setRequested(true);

    if (subjectType !== 'entity') return;
    setLookup('searching');
    try {
      const res = await fetch(`/api/entities/${subjectId}/enrich`, { method: 'POST' });
      const body = await res.json();
      if (!body.ok) { setLookup('error'); return; }
      if (!body.configured) { setLookup('not_configured'); return; }
      if (body.count > 0) { setLookup('found'); onEnriched?.(); return; }
      setLookup('no_findings');
    } catch {
      setLookup('error');
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-400" title={result.missing.length ? `Missing: ${result.missing.join(', ')}` : 'Complete'}>
      <span className={low ? 'text-amber-600' : 'text-gray-400'}>Profile {result.percent}% complete</span>
      {low && authEnabled && (
        !requested
          ? <button onClick={requestMoreInfo} className="text-[#0E7490] hover:underline">Request more info</button>
          : <span className="text-gray-400">
              {lookup === 'searching' && 'searching public sources…'}
              {lookup === 'found' && '— suggestions added below, unconfirmed'}
              {lookup === 'no_findings' && '— no confident matches found'}
              {lookup === 'not_configured' && '— requested'}
              {lookup === 'error' && '— requested (lookup failed, try again later)'}
              {lookup === 'idle' && '— requested'}
            </span>
      )}
    </span>
  );
}
