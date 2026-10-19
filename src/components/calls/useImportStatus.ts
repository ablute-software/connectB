'use client';
// Prompt 909 (Adenda 2b) — is a reading in progress on this call, or a proposal waiting? Asked when the editor opens and whenever the import dialog
// closes (`reloadKey`); while a reading is in progress it asks again every few seconds, so the pill turns to "Proposal ready to review" by itself.
import { useEffect, useState } from 'react';
import { importStatusOf, type ImportStatus } from '@/lib/calls/ai-import/screen-state';
import { callsApi } from './api';

const POLL_MS = 5000;

export function useImportStatus(callId: string, reloadKey: number): { status: ImportStatus; runId: string | null } {
  const [status, setStatus] = useState<ImportStatus>(null);
  const [runId, setRunId] = useState<string | null>(null);
  useEffect(() => {
    let alive = true; let timer: ReturnType<typeof setTimeout> | null = null;
    const check = async () => {
      const r = await callsApi.importState(callId);
      if (!alive) return;
      const s = r.ok ? importStatusOf(r.body) : null;
      setStatus(s);
      setRunId(r.ok ? (r.body.reading?.id ?? r.body.pending?.id ?? null) : null);
      if (s === 'reading') timer = setTimeout(() => void check(), POLL_MS);
    };
    void check();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [callId, reloadKey]);
  return { status, runId };
}
