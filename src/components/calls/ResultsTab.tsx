'use client';
// Prompt 924 (Etapa 4) — the Results tab of a call. For whoever may "Publish results": Prepare (this increment), then Publish and Contestations in the next ones. The server checks the permission on every
// request; this tab only shows what the person may use.
import { PrepareResults } from './PrepareResults';

export function ResultsTab({ callId, canPublish, onOpenEvaluation }: { callId: string; canPublish: boolean; canHandle: boolean; onOpenEvaluation?: () => void }) {
  if (!canPublish) {
    return <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600" data-testid="results-no-permission">You do not have the “Publish results” permission on this call. Ask the call’s administrators.</p>;
  }
  return <PrepareResults callId={callId} onOpenEvaluation={onOpenEvaluation} />;
}
