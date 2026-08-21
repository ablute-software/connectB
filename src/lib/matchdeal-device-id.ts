'use client';
// Prompt 295 — extracted from pair/page.tsx (was a private, unexported
// helper there) so MatchDealHeartbeat.tsx's own self-check resolves to
// the EXACT SAME device id — a second, drifted copy of this localStorage
// key would silently break /api/matchdeal/pairing/self's device-based
// kind-preference logic for one of the two call sites.
const DEVICE_ID_KEY = 'sherlockdeal_pwa_device_id';

export function getOrCreateDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(DEVICE_ID_KEY, id); }
  return id;
}
