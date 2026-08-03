'use client';
// Prompt 103 Bloco 2 — Vault Data Room 4-digit PIN, per user, on top of the
// existing role-level data_room_read capability (that already blocks a role
// out entirely via Permissions; this is a second, personal layer). Every
// write/verify goes through a security-definer RPC (vault_pin_*, migration
// 0101) — pin_hash is never selectable by the client at all (the table's
// column-level grant excludes it), so there is nothing to expose here even
// on a compromised client.
//
// Unlock persistence, per Nuno's confirmed answer (not "every navigation"
// as the prompt's own default; not literal "once per session" either):
// unlocked for the tab session, but re-locked if the tab was hidden/the
// window lost focus for 5+ minutes — sessionStorage (not localStorage) so
// a genuinely new tab/window always re-checks.
import { useCallback, useEffect, useState } from 'react';
import { authEnabled, browserClient } from '@/lib/supabase';

const UNLOCK_KEY = 'vault_unlocked_org';
const HIDDEN_AT_KEY = 'vault_hidden_at';
const AWAY_LIMIT_MS = 5 * 60 * 1000;

type Status = 'loading' | 'setup' | 'locked' | 'unlocked';

export function VaultPinGate({ orgId, children }: { orgId: string; children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>(authEnabled ? 'loading' : 'unlocked');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [skipChecked, setSkipChecked] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const checkStatus = useCallback(async () => {
    if (!authEnabled || !orgId) { setStatus('unlocked'); return; }
    const { data, error } = await browserClient().rpc('vault_pin_status', { p_org_id: orgId });
    if (error) { setErr(error.message); setStatus('locked'); return; }
    const row = (data as { has_pin: boolean; pin_skipped: boolean }[] | null)?.[0];
    if (!row || (!row.has_pin && !row.pin_skipped)) { setStatus('setup'); return; }
    if (row.pin_skipped) { setStatus('unlocked'); return; }
    if (sessionStorage.getItem(UNLOCK_KEY) === orgId) { setStatus('unlocked'); return; }
    setStatus('locked');
  }, [orgId]);

  useEffect(() => { void checkStatus(); }, [checkStatus]);

  // Away-for-5-minutes re-lock. visibilitychange covers tab switches;
  // window blur/focus covers switching to another application entirely.
  useEffect(() => {
    if (!authEnabled) return;
    function onAway() {
      if (document.hidden) sessionStorage.setItem(HIDDEN_AT_KEY, String(Date.now()));
    }
    function onBack() {
      if (document.hidden) return;
      const hiddenAt = Number(sessionStorage.getItem(HIDDEN_AT_KEY) ?? 0);
      if (hiddenAt && Date.now() - hiddenAt > AWAY_LIMIT_MS) {
        sessionStorage.removeItem(UNLOCK_KEY);
        void checkStatus();
      }
    }
    document.addEventListener('visibilitychange', onAway);
    document.addEventListener('visibilitychange', onBack);
    window.addEventListener('blur', onAway);
    window.addEventListener('focus', onBack);
    return () => {
      document.removeEventListener('visibilitychange', onAway);
      document.removeEventListener('visibilitychange', onBack);
      window.removeEventListener('blur', onAway);
      window.removeEventListener('focus', onBack);
    };
  }, [checkStatus]);

  async function submitSetup() {
    setErr('');
    if (skipChecked) {
      setBusy(true);
      const { error } = await browserClient().rpc('vault_pin_skip', { p_org_id: orgId });
      setBusy(false);
      if (error) { setErr(error.message); return; }
      setStatus('unlocked');
      return;
    }
    if (!/^\d{4}$/.test(pin)) { setErr('Enter exactly 4 digits.'); return; }
    if (pin !== confirmPin) { setErr('Codes do not match.'); return; }
    setBusy(true);
    const { error } = await browserClient().rpc('vault_pin_set', { p_org_id: orgId, p_pin: pin });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    sessionStorage.setItem(UNLOCK_KEY, orgId);
    setStatus('unlocked');
  }

  async function submitUnlock() {
    setErr('');
    setBusy(true);
    const { data, error } = await browserClient().rpc('vault_pin_verify', { p_org_id: orgId, p_pin: pin });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    if (!data) { setErr('Incorrect code.'); setPin(''); return; }
    sessionStorage.setItem(UNLOCK_KEY, orgId);
    setStatus('unlocked');
  }

  if (status === 'unlocked') return <>{children}</>;
  if (status === 'loading') {
    return <div className="flex min-h-[40vh] items-center justify-center text-sm text-gray-400">Loading…</div>;
  }

  return (
    <div className="relative">
      <div className="pointer-events-none select-none blur-md" aria-hidden="true">{children}</div>
      <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/50 backdrop-blur-sm">
        <div className="w-full max-w-xs rounded-2xl border border-gray-200 bg-white p-5 shadow-xl">
          {status === 'setup' ? (
            <>
              <h2 className="text-sm font-semibold text-gray-900">Set a Vault Data Room code</h2>
              <p className="mt-1 text-xs text-gray-500">A 4-digit code only you know, on top of your account's own access controls.</p>
              <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" placeholder="0000"
                disabled={skipChecked}
                className="mt-3 w-full rounded border border-gray-300 px-2 py-1.5 text-center text-lg tracking-widest disabled:bg-gray-50" />
              <input value={confirmPin} onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" placeholder="Confirm"
                disabled={skipChecked}
                className="mt-2 w-full rounded border border-gray-300 px-2 py-1.5 text-center text-lg tracking-widest disabled:bg-gray-50" />
              <label className="mt-3 flex items-start gap-2 text-xs text-gray-500">
                <input type="checkbox" checked={skipChecked} onChange={(e) => setSkipChecked(e.target.checked)} className="mt-0.5" />
                <span>Skip this — without a code, anyone with access to this computer can open the Vault Data Room while you're signed in. That's on you.</span>
              </label>
              {err && <p className="mt-2 text-xs text-[#B00000]">{err}</p>}
              <button disabled={busy} onClick={() => void submitSetup()}
                className="mt-3 w-full rounded-lg bg-[#0E7490] py-2 text-sm font-medium text-white disabled:opacity-50">
                {busy ? 'Saving…' : skipChecked ? 'Skip and continue' : 'Set code'}
              </button>
            </>
          ) : (
            <>
              <h2 className="text-sm font-semibold text-gray-900">Enter your Vault Data Room code</h2>
              <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" placeholder="0000"
                onKeyDown={(e) => e.key === 'Enter' && void submitUnlock()}
                className="mt-3 w-full rounded border border-gray-300 px-2 py-1.5 text-center text-lg tracking-widest" autoFocus />
              {err && <p className="mt-2 text-xs text-[#B00000]">{err}</p>}
              <button disabled={busy || pin.length !== 4} onClick={() => void submitUnlock()}
                className="mt-3 w-full rounded-lg bg-[#0E7490] py-2 text-sm font-medium text-white disabled:opacity-50">
                {busy ? 'Checking…' : 'Unlock'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
