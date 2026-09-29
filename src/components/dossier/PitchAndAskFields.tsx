'use client';
// Prompt 893 §D — "How we pitch this firm" (our_angle) and "What we ask
// for first" (the_ask), extracted out of EntityDossierPanel.tsx so the
// SAME editable component (same "Write" pencil pattern, same TermHint
// explanations, same provenance badge) renders in both the Pipeline panel
// and the full dossier — before this prompt the full dossier showed these
// two fields read-only, which is what led Nuno to conclude they were
// "Sherlock's own suggestion" even when he had typed them himself
// (entities/[id]/page.tsx:974-975, now removed).
//
// Provenance: `our_angle_source` ('founder' | 'sherlock' | undefined,
// migration 20260929190000) is set to 'sherlock' only by the market-data
// bridge's add-target route (the one automated writer of `our_angle`
// today) and flips to 'founder' the instant the founder edits it here —
// see saveOurAngle below. `the_ask` has no automated writer, so it carries
// no provenance badge.
import { useState } from 'react';
import type { Entity } from '@/lib/types';
import { TermHint } from '@/components/ui';

function EmptyField({ onEdit }: { onEdit: () => void }) {
  return (
    <span className="text-gray-400">
      Only you know this. <button onClick={onEdit} className="ml-1 text-cyan-700 hover:underline">Write</button>
    </span>
  );
}

export function PitchAndAskFields({ entity, onSave }: {
  entity: Pick<Entity, 'id' | 'our_angle' | 'our_angle_source' | 'the_ask'>;
  onSave: (patch: Partial<Entity>) => void;
}) {
  const [editingOurAngle, setEditingOurAngle] = useState(false);
  const [ourAngleDraft, setOurAngleDraft] = useState('');
  const [editingTheAsk, setEditingTheAsk] = useState(false);
  const [theAskDraft, setTheAskDraft] = useState('');

  function saveOurAngle() {
    // The founder editing this by hand is always the strongest, most
    // recent signal of authorship — overwrites any earlier 'sherlock'
    // provenance the same way the text itself is overwritten.
    onSave({ our_angle: ourAngleDraft.trim() || undefined, our_angle_source: 'founder' });
    setEditingOurAngle(false);
  }
  function saveTheAsk() {
    onSave({ the_ask: theAskDraft.trim() || undefined });
    setEditingTheAsk(false);
  }

  return (
    <dl className="space-y-3 text-sm">
      <div>
        <dt className="flex items-center text-xs text-gray-500">
          How we pitch this firm
          <TermHint text="Your positioning for this firm — what you lead with. Watson and the form assistant use it." />
          {!editingOurAngle && (
            <button onClick={() => { setOurAngleDraft(entity.our_angle ?? ''); setEditingOurAngle(true); }}
              title="Edit" className="ml-1 text-[11px] text-gray-300 hover:text-cyan-700">✎</button>
          )}
        </dt>
        {editingOurAngle ? (
          <dd className="mt-1">
            <textarea value={ourAngleDraft} onChange={(e) => setOurAngleDraft(e.target.value)} autoFocus rows={2}
              placeholder="Your angle for this firm…" className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
            <div className="mt-1 flex gap-2">
              <button onClick={saveOurAngle} className="rounded bg-[#0E7490] px-2 py-0.5 text-[11px] font-medium text-white">Save</button>
              <button onClick={() => setEditingOurAngle(false)} className="text-[11px] text-gray-500">Cancel</button>
            </div>
          </dd>
        ) : (
          <dd>
            {entity.our_angle ?? <EmptyField onEdit={() => { setOurAngleDraft(entity.our_angle ?? ''); setEditingOurAngle(true); }} />}
            {entity.our_angle && entity.our_angle_source === 'sherlock' && (
              <div className="mt-0.5 text-[11px] italic text-cyan-700">
                Suggested by Sherlock from a competitor-investment match — edit or keep.
              </div>
            )}
          </dd>
        )}
      </div>
      <div>
        <dt className="flex items-center text-xs text-gray-500">
          What we ask for first
          <TermHint text="The one small thing you ask for in the first contact (a 20-minute call, an intro, a deck submission). Watson uses it." />
          {!editingTheAsk && (
            <button onClick={() => { setTheAskDraft(entity.the_ask ?? ''); setEditingTheAsk(true); }}
              title="Edit" className="ml-1 text-[11px] text-gray-300 hover:text-cyan-700">✎</button>
          )}
        </dt>
        {editingTheAsk ? (
          <dd className="mt-1">
            <textarea value={theAskDraft} onChange={(e) => setTheAskDraft(e.target.value)} autoFocus rows={2}
              placeholder="The one, small thing to ask for…" className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
            <div className="mt-1 flex gap-2">
              <button onClick={saveTheAsk} className="rounded bg-[#0E7490] px-2 py-0.5 text-[11px] font-medium text-white">Save</button>
              <button onClick={() => setEditingTheAsk(false)} className="text-[11px] text-gray-500">Cancel</button>
            </div>
          </dd>
        ) : (
          <dd className="font-medium">
            {entity.the_ask ?? <EmptyField onEdit={() => { setTheAskDraft(entity.the_ask ?? ''); setEditingTheAsk(true); }} />}
          </dd>
        )}
      </div>
    </dl>
  );
}
