// Prompt 92 — MatchDeal PWA install prompt. Platform detection + the
// bounded-recurrence rule live here (pure/testable); the actual UI and the
// beforeinstallprompt listener live in components/matchdeal/InstallPrompt.tsx
// (needs window/localStorage, can't be unit tested the same way).

// Approved as proposed, 02/08: show again after whichever comes first —
// 3 days since the last dismiss, or 3 sessions (page mounts) since then.
// Never on a device that's already installed (standalone display mode).
export const INSTALL_PROMPT_DAYS_THRESHOLD = 3;
export const INSTALL_PROMPT_SESSIONS_THRESHOLD = 3;

const DISMISSED_AT_KEY = 'sherlockdeal_pwa_install_dismissed_at';
const SESSIONS_KEY = 'sherlockdeal_pwa_install_sessions_since_dismiss';

export interface InstallPromptState {
  dismissedAt: string | null; // ISO timestamp, or null if never dismissed
  sessionsSinceDismiss: number;
}

// Pure — the actual show/hide decision, given a snapshot of state and "now"
// (passed in rather than read internally so this is trivially testable).
export function shouldShowInstallPrompt(state: InstallPromptState, now: Date): boolean {
  if (!state.dismissedAt) return true; // never dismissed — first time this device is seen
  const daysSinceDismiss = (now.getTime() - new Date(state.dismissedAt).getTime()) / 86_400_000;
  return daysSinceDismiss >= INSTALL_PROMPT_DAYS_THRESHOLD || state.sessionsSinceDismiss >= INSTALL_PROMPT_SESSIONS_THRESHOLD;
}

export function readInstallPromptState(): InstallPromptState {
  if (typeof localStorage === 'undefined') return { dismissedAt: null, sessionsSinceDismiss: 0 };
  return {
    dismissedAt: localStorage.getItem(DISMISSED_AT_KEY),
    sessionsSinceDismiss: Number(localStorage.getItem(SESSIONS_KEY) ?? '0'),
  };
}

// Called once per /pair mount (not per dismiss) — advances the session
// counter that shouldShowInstallPrompt checks against the threshold.
export function recordInstallPromptSessionSeen(): void {
  if (typeof localStorage === 'undefined') return;
  const state = readInstallPromptState();
  localStorage.setItem(SESSIONS_KEY, String(state.sessionsSinceDismiss + 1));
}

export function recordInstallPromptDismissed(now: Date): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(DISMISSED_AT_KEY, now.toISOString());
  localStorage.setItem(SESSIONS_KEY, '0');
}

// display-mode: standalone covers Android/desktop PWA installs;
// navigator.standalone is iOS Safari's own non-standard equivalent (no
// display-mode support there pre-installation). Checking both is the only
// reliable way to know "is this already installed" across platforms.
export function isStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
  return !!(window.navigator as unknown as { standalone?: boolean }).standalone;
}

// iOS has no beforeinstallprompt — this is the only way to know to show the
// manual Share-sheet instructions instead of the Android native button.
export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}
