// Prompt 403 §A.2 / 404 §A — the Vault privacy notice's reawakening
// schedule, as a pure function so the month-boundary cases are provable
// without faking wall-clock time in a browser: immediately at
// first_shown_at (T0), then T0+2mo, T0+4mo, then every 4mo after that,
// indefinitely. "Due" compares against the last time the notice was
// actually acknowledged (last_shown_at), not against "ever shown" —
// reappearing on schedule is the point, not a bug to guard against.
export function addMonthsUtc(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

export function isVaultPrivacyNoticeDue(
  firstShownAt: Date | null,
  lastShownAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (!firstShownAt) return true; // never shown at all — this visit IS T0
  const targets = [firstShownAt, addMonthsUtc(firstShownAt, 2), addMonthsUtc(firstShownAt, 4)];
  while (targets[targets.length - 1] <= now) {
    targets.push(addMonthsUtc(targets[targets.length - 1], 4));
  }
  const passed = targets.filter((t) => t <= now);
  if (passed.length === 0) return false;
  const latestDue = passed[passed.length - 1];
  return !lastShownAt || latestDue > lastShownAt;
}

// Demo-mode (no Supabase configured) persistence — same lightweight
// per-key localStorage pattern already used a few lines up in
// documents/page.tsx for the folder-collapse state, rather than routing
// through the full useStore() reducer for a single small client-only flag.
const DEMO_KEY = 'vault-privacy-notice-demo';

export function readDemoVaultPrivacyNotice(): { firstShownAt: Date | null; lastShownAt: Date | null } {
  if (typeof localStorage === 'undefined') return { firstShownAt: null, lastShownAt: null };
  try {
    const raw = localStorage.getItem(DEMO_KEY);
    if (!raw) return { firstShownAt: null, lastShownAt: null };
    const parsed = JSON.parse(raw) as { firstShownAt: string | null; lastShownAt: string | null };
    return {
      firstShownAt: parsed.firstShownAt ? new Date(parsed.firstShownAt) : null,
      lastShownAt: parsed.lastShownAt ? new Date(parsed.lastShownAt) : null,
    };
  } catch {
    return { firstShownAt: null, lastShownAt: null };
  }
}

export function writeDemoVaultPrivacyNotice(state: { firstShownAt: Date | null; lastShownAt: Date | null }): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(DEMO_KEY, JSON.stringify({
    firstShownAt: state.firstShownAt ? state.firstShownAt.toISOString() : null,
    lastShownAt: state.lastShownAt ? state.lastShownAt.toISOString() : null,
  }));
}
