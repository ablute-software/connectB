'use client';
// Prompt 410 §2.3 — the interest-decision flow (POST the decision, then
// close the local task so sherlockNext/Today/the entity dossier all stop
// pointing at it immediately, without waiting for a reload) used to live
// only inside TodayPanel (its own decideInterest, ~lines 117-135).
// SherlockInsightBanner now needs the exact same flow for its own inline
// Approve/Deny (§2.3) — extracted here so there's one copy, never two that
// could drift. decideInterestRequest itself already fires
// INTEREST_REQUEST_DECIDED_EVENT (interest-requests-client.ts), which is
// what makes every mounted useInterestRequests() caller re-check without a
// reload — this hook only adds the local toggleTask + busy bookkeeping.
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { decideInterestRequest } from '@/lib/interest-requests-client';

export function useDecideInterest() {
  const { toggleTask } = useStore();
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  async function decideInterest(taskId: string, requestId: string, decision: 'granted' | 'denied') {
    setBusyTaskId(taskId);
    try {
      await decideInterestRequest(requestId, decision);
      toggleTask(taskId);
    } finally { setBusyTaskId(null); }
  }

  return { decideInterest, busyTaskId };
}
