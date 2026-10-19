'use client';
// Prompt 905 — the Calls area inside an entity's workspace: the list, and the editor of one call. Mounted by the
// investor workspace and the ecosystem workspace when the Calls tab is selected.
import { useEffect, useState } from 'react';
import type { PromoterKind } from '@/lib/calls/types';
import { CallEditor } from './CallEditor';
import { CallsList } from './CallsList';

export function CallsWorkspace({ kind }: { kind: PromoterKind }) {
  // `importFirst`: the call was just created "from documents", so the editor opens on the import dialog.
  // `runId`: open on THAT proposal's review (from a notice or the call's card), not on the upload form.
  const [open, setOpen] = useState<{ id: string; importFirst: boolean; runId: string | null } | null>(null);
  // A link names the call to open (?call=<id>, and where in it: section/step, or an old ?tab=): the editor reads the rest from the address. Only for a well-formed id.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('call');
    if (id && /^[0-9a-f-]{36}$/i.test(id)) setOpen((o) => o ?? { id, importFirst: false, runId: null });
  }, []);
  return open
    ? <CallEditor key={open.id} callId={open.id} startImport={open.importFirst} startRunId={open.runId} onBack={() => setOpen(null)} />
    : <CallsList kind={kind} onOpen={(id, opts) => setOpen({ id, importFirst: opts?.importFirst === true, runId: opts?.runId ?? null })} />;
}
