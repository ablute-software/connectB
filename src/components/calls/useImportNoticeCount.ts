'use client';
// Prompt 909 (Adenda 2b) — how many unseen import notices the person has, for the badge on the Calls tab of the workspace (the tab is visible wherever
// they navigate inside it). Asked when the workspace mounts, every 30 s, and at once when a notice is seen or dismissed.
import { useEffect, useState } from 'react';
import { IMPORT_NOTICES_EVENT } from '@/lib/calls/ai-import/screen-state';
import { callsApi } from './api';

const POLL_MS = 30_000;

export function useImportNoticeCount(enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) { setCount(0); return; }
    let alive = true;
    const load = async () => { const r = await callsApi.importNotices(); if (alive && r.ok) setCount((r.body.notices ?? []).length); };
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    const onChange = () => void load();
    window.addEventListener(IMPORT_NOTICES_EVENT, onChange);
    return () => { alive = false; clearInterval(timer); window.removeEventListener(IMPORT_NOTICES_EVENT, onChange); };
  }, [enabled]);
  return count;
}
