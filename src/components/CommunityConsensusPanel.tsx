'use client';
// Prompt 266 §2 — read-only summary of community-consensus values for this
// entity's still-blank fields (score>0, >=2 agreeing orgs; visibility
// computed server-side by consensusVisibility). Confirm/unconfirm here
// hits /api/community-consensus/vote (±1, upsert per org — never a second
// vote from the same org "for free"); a vote that drops score to 0 removes
// the row from view client-side too, matching the server's own score<=0
// "hidden" threshold. "Use this" pulls the value into the founder's own
// dossier — same accept semantics as an AI-pending contribution
// (ContributionBox's resolveAiProposal), not a silent auto-fill.
import { useEffect, useState } from 'react';
import { authEnabled } from '@/lib/supabase';
import { ENTITY_ENRICHMENT_FIELD_LABELS, isKnownEntityField } from '@/lib/entity-enrichment';
import { Tooltip } from '@/components/ui';

type CommunityField = {
  consensusId: string; field: string; value: unknown; score: number;
  visibility: 'community' | 'verified'; yourVote: 1 | -1 | null;
};

function fieldLabel(field: string): string {
  return isKnownEntityField(field) ? ENTITY_ENRICHMENT_FIELD_LABELS[field] : field;
}

function formatValue(value: unknown): string {
  return Array.isArray(value) ? value.join(', ') : String(value);
}

export function CommunityConsensusPanel({ entityId, onApplyValue }: {
  entityId: string;
  onApplyValue: (field: string, value: unknown) => void;
}) {
  const [fields, setFields] = useState<CommunityField[]>([]);
  const [votingId, setVotingId] = useState<string | null>(null);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!authEnabled) return;
    setAppliedIds(new Set());
    fetch(`/api/community-consensus/entity/${entityId}`).then((r) => r.json())
      .then((d) => setFields(d.fields ?? [])).catch(() => {});
  }, [entityId]);

  async function vote(f: CommunityField, v: 1 | -1) {
    setVotingId(f.consensusId);
    try {
      const res = await fetch('/api/community-consensus/vote', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ consensusId: f.consensusId, vote: v }),
      });
      const body = await res.json();
      if (body.ok) {
        setFields((prev) => prev
          .map((x) => (x.consensusId === f.consensusId ? { ...x, score: body.score, yourVote: body.yourVote } : x))
          .filter((x) => x.score > 0));
      }
    } finally {
      setVotingId(null);
    }
  }

  function apply(f: CommunityField) {
    onApplyValue(f.field, f.value);
    setAppliedIds((prev) => new Set(prev).add(f.consensusId));
  }

  if (!authEnabled || fields.length === 0) return null;

  return (
    <div className="mt-4 rounded-lg border border-[#0E7490]/20 bg-[#E8F4F8] p-3">
      <div className="text-xs font-semibold text-[#0E7490]">Community-sourced facts</div>
      <div className="mt-0.5 text-[11px] text-gray-500">
        Other founders independently added these for the same investor — not yet part of your own dossier.
      </div>
      <div className="mt-2 space-y-1.5">
        {fields.map((f) => {
          const applied = appliedIds.has(f.consensusId);
          return (
            <div key={f.consensusId} className="rounded-lg border border-white bg-white/60 p-2 text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium text-gray-700">{fieldLabel(f.field)}:</span>
                <span className="text-gray-700">{formatValue(f.value)}</span>
                <Tooltip text={f.visibility === 'verified'
                  ? 'Confirmed by enough founders and votes to be treated as reliable.'
                  : 'Two founders independently reported this for the same investor. Not yet verified — vote to confirm or reject it.'}>
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${f.visibility === 'verified' ? 'bg-green-100 text-green-700' : 'bg-cyan-100 text-cyan-800'}`}>
                    {f.visibility === 'verified' ? 'community · verified' : 'community · unconfirmed'}
                  </span>
                </Tooltip>
              </div>
              <div className="mt-1 flex items-center gap-1.5">
                <button disabled={votingId === f.consensusId || f.yourVote === 1} onClick={() => vote(f, 1)}
                  className={`rounded border px-1.5 py-0.5 text-[11px] ${f.yourVote === 1 ? 'border-green-300 bg-green-50 text-green-700' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'} disabled:opacity-40`}>
                  Confirm
                </button>
                <button disabled={votingId === f.consensusId || f.yourVote === -1} onClick={() => vote(f, -1)}
                  className={`rounded border px-1.5 py-0.5 text-[11px] ${f.yourVote === -1 ? 'border-red-300 bg-red-50 text-red-700' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'} disabled:opacity-40`}>
                  Doesn&apos;t match
                </button>
                <button disabled={applied} onClick={() => apply(f)}
                  className="ml-auto rounded bg-[#0E7490] px-2 py-0.5 font-medium text-white disabled:opacity-40">
                  {applied ? 'Added' : 'Use this'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
