'use client';
// Prompt 905 — the Calls area inside an entity's workspace: the list, and the editor of one call. Mounted by the
// investor workspace and the ecosystem workspace when the Calls tab is selected.
import { useState } from 'react';
import type { PromoterKind } from '@/lib/calls/types';
import { CallEditor } from './CallEditor';
import { CallsList } from './CallsList';

export function CallsWorkspace({ kind }: { kind: PromoterKind }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return openId
    ? <CallEditor key={openId} callId={openId} onBack={() => setOpenId(null)} />
    : <CallsList kind={kind} onOpen={setOpenId} />;
}
