'use client';
// Prompt 924 (Etapa 4) — the Results tab of a call. For whoever may "Publish results": Prepare (what each applicant will be told), Publish (the test, the publication, the state of every email) — and Contestations
// in the next increment. The server checks the permission on every request; this tab only shows what the person may use.
import { useState } from 'react';
import { PrepareResults } from './PrepareResults';
import { PublishResults } from './PublishResults';

type Section = 'prepare' | 'publish';
const SECTIONS: { key: Section; label: string }[] = [{ key: 'prepare', label: 'Prepare' }, { key: 'publish', label: 'Publish' }];

export function ResultsTab({ callId, canPublish, onOpenEvaluation }: { callId: string; canPublish: boolean; canHandle: boolean; onOpenEvaluation?: () => void }) {
  const [section, setSection] = useState<Section>('prepare');
  if (!canPublish) {
    return <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600" data-testid="results-no-permission">You do not have the “Publish results” permission on this call. Ask the call’s administrators.</p>;
  }
  return (
    <div className="min-w-0" data-testid="results-tab">
      <div role="tablist" aria-label="Results" className="mb-4 flex gap-1 overflow-x-auto whitespace-nowrap border-b border-gray-200" data-testid="results-sections">
        {SECTIONS.map((s) => (
          <button key={s.key} type="button" role="tab" aria-selected={section === s.key} data-testid={`results-section-${s.key}`} onClick={() => setSection(s.key)}
            className={`-mb-px min-h-[44px] shrink-0 border-b-2 px-4 py-2 text-sm ${section === s.key ? 'border-[#0E7490] font-semibold text-[#0E7490]' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>{s.label}</button>
        ))}
      </div>
      {section === 'prepare' ? <PrepareResults callId={callId} onOpenEvaluation={onOpenEvaluation} /> : <PublishResults callId={callId} onOpenPrepare={() => setSection('prepare')} />}
    </div>
  );
}
