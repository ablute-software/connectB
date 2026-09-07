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

export function EnrichmentBadge({ result, subjectType, subjectId, orgId, label, low: lowOverride, onEnriched }: {
  result: CompletenessResult; subjectType: 'entity' | 'person'; subjectId: string; orgId: string;
  // Optional dimension label ("Firmographic" / "Contact") when an entity
  // shows more than one badge — omitted, this reads "Profile X% complete"
  // exactly as before (unchanged for the single-score person badge).
  label?: string;
  // Override the internal `percent < ENRICHMENT_THRESHOLD` low-signal calc.
  // Needed for the contact dimension, whose own percent is misleading in
  // isolation (see qualifiesForContactEnrichment) — most callers omit this.
  low?: boolean;
  // Called once a lookup finds and stores at least one suggestion, so the
  // caller can refresh whatever list is showing pending contributions.
  onEnriched?: () => void;
}) {
  const [requested, setRequested] = useState(false);
  const [lookup, setLookup] = useState<LookupState>('idle');
  const low = lowOverride ?? result.percent < ENRICHMENT_THRESHOLD;

  async function requestMoreInfo() {
    if (!authEnabled) return;
    // Prompt 572 §C.2 — this row is a record of a REQUEST (an automation
    // trigger), not an authored contribution someone needs to review. It
    // used to sit in Contributions as 'submitted' forever — one of the 4
    // rows in production with no field proposal to approve, because there
    // never was one. author_user_id is still the same missing-provenance
    // bug every other insert in this queue had (§C.1).
    const { data: { user } } = await browserClient().auth.getUser();
    const { data: created } = await browserClient().from('contributions').insert({
      subject_type: subjectType, subject_id: subjectId, org_id: orgId, author_user_id: user?.id ?? null,
      field: ENRICHMENT_REQUEST_FIELD, value: true, note: `Missing${label ? ` (${label})` : ''}: ${result.missing.join(', ')}`,
    }).select('id').single();
    setRequested(true);

    if (subjectType !== 'entity') return; // demand-flag only — no lookup exists for people yet
    setLookup('searching');
    try {
      const res = await fetch(`/api/entities/${subjectId}/enrich`, { method: 'POST' });
      const body = await res.json();
      // The automation FINISHED either way below (ok, whether or not it
      // found anything) — that's what closes the request row. Only a real
      // failure (network/config) leaves it open for the "Requests" filter
      // (default: failed only) to surface for a manual retry.
      if (!body.ok) { setLookup('error'); return; }
      if (!body.configured) { setLookup('not_configured'); return; }
      if (created?.id) {
        await browserClient().from('contributions').update({ status: 'verified' }).eq('id', created.id);
      }
      if (body.count > 0) { setLookup('found'); onEnriched?.(); return; }
      setLookup('no_findings');
    } catch {
      setLookup('error');
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-400" title={result.missing.length ? `Missing: ${result.missing.join(', ')}` : 'Complete'}>
      <span className={low ? 'text-amber-600' : 'text-gray-400'}>{label ?? 'Profile'} {result.percent}% complete</span>
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
