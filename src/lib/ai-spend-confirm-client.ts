'use client';
// Prompt 706 — thin client-side fetch helpers for the two things
// insufficientInfoDialog() needs before it can be shown: the org's current
// critical-gap count (the SAME /api/blueprint gaps ReviewPanel.tsx already
// loads for its own card — fetched independently here since this popup
// fires from several different component trees, not just ReviewPanel) and
// the action's own wallet status. Both fail soft: a fetch problem here
// must never be the reason a legitimate action gets blocked, or interrupted
// with a broken popup — see ai-credits.ts's own fail-CLOSED note for why
// that discipline applies to the CHARGE, not to this merely-informational
// pre-check.
import { countCriticalGaps } from './ai-spend-confirm';
import type { WalletStatus } from './ai-credits';

export async function fetchCriticalGapCount(): Promise<number> {
  try {
    const body = await fetch('/api/blueprint').then((r) => r.json());
    if (!body?.available) return 0;
    return countCriticalGaps((body.gaps ?? []) as { severity: string }[]);
  } catch {
    return 0;
  }
}

export async function fetchWalletStatus(actionKey: string): Promise<WalletStatus | null> {
  try {
    const body = await fetch(`/api/ai-credits/status?action=${encodeURIComponent(actionKey)}`).then((r) => r.json());
    return body?.ok ? (body.status as WalletStatus) : null;
  } catch {
    return null;
  }
}
