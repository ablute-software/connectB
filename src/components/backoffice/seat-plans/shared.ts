'use client';
// Prompt 904 Adenda 1 (v2) — what the four sub-tabs of /backoffice/seat-plans share: the shapes the route
// returns, the two fetch helpers, and the hook that loads one firm and runs actions on it.
import { useCallback, useEffect, useState } from 'react';

export type Member = { id: string; email: string | null; name: string | null; role: string | null; since: string | null };
export type Invite = { id: string; email: string; createdAt: string };
export type Code = {
  id: string; codeHint: string; seats: number; status: 'active' | 'redeemed' | 'revoked'; expiresAt: string;
  redeemedAt: string | null; redeemedByEmail: string | null; createdAt: string;
};
export type PendingClaim = { id: string; email: string; requestedRole: string | null; createdAt: string };
export type Detail = {
  entity: { id: string; name: string; is_test: boolean | null };
  plan: { planName: string; seats: number; tier: string; adminEmail: string | null } | null;
  limit: number; used: number; reserved: number; free: number;
  members: Member[]; invites: Invite[]; codes: Code[]; pendingClaims: PendingClaim[];
};
export type Hit = { id: string; name: string; website: string | null; is_test: boolean | null };

export const day = (iso: string | null | undefined) => (iso ? new Date(iso).toISOString().slice(0, 10) : '—');
export const stamp = (iso: string | null | undefined) => (iso ? `${new Date(iso).toISOString().slice(0, 16).replace('T', ' ')} UTC` : '—');

const API = '/api/backoffice/investor-seats';

export async function post(body: Record<string, unknown>) {
  const res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return res.json() as Promise<Record<string, unknown> & { ok: boolean; error?: string }>;
}
export async function getJson<T = Record<string, unknown>>(qs: string) {
  const res = await fetch(`${API}${qs}`);
  return res.json() as Promise<T & { ok?: boolean; error?: string; migrationPending?: boolean }>;
}

/** One firm: its detail, and `act` to run an action on it, reload, and report the result. */
export function useFirmDetail(entityId: string | null, onChanged?: () => void) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [newCode, setNewCode] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!entityId) { setDetail(null); return; }
    const d = await getJson<Detail>(`?entityId=${entityId}`);
    if (!d.ok) { setErr(d.error ?? 'Could not load.'); return; }
    setDetail(d as Detail);
  }, [entityId]);

  useEffect(() => { setErr(''); setMsg(''); setNewCode(null); void reload(); }, [reload]);

  /** Returns the route's answer so the caller can react (e.g. End plan moves to another sub-tab). */
  const act = useCallback(async (body: Record<string, unknown>, okMsg: string | ((r: Record<string, unknown>) => string)) => {
    if (!entityId) return null;
    setErr(''); setMsg(''); setNewCode(null);
    const d = await post({ entityId, ...body });
    if (!d.ok) { setErr(d.error ?? 'Failed.'); return d; }
    setMsg(typeof okMsg === 'function' ? okMsg(d) : okMsg);
    if (typeof d.code === 'string') setNewCode(d.code);
    await reload();
    onChanged?.();
    return d;
  }, [entityId, reload, onChanged]);

  return { detail, err, msg, newCode, setErr, act, reload };
}

/** Copies text; falls back to selecting it when the Clipboard API is not available (http, old browsers). */
export async function copyText(text: string, fallbackEl?: HTMLElement | null): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through */ }
  try {
    if (fallbackEl) {
      const range = document.createRange(); range.selectNodeContents(fallbackEl);
      const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(range);
      return document.execCommand('copy');
    }
  } catch { /* nothing else to try */ }
  return false;
}
