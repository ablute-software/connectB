// Prompt 526 Part B — the guest previews' route table and copy.
//
// Plain .ts, not co-located in GuestPreviewShell.tsx, for one concrete
// reason: vitest in this repo has no JSX transform configured, so a test can
// import this but not the component. The copy below is exactly what needs a
// test (see guest-preview-routes.test.ts), so it lives where a test can
// reach it.
export const PREVIEWS = [
  { key: 'pipeline', icon: '▤', label: 'Pipeline', href: '/guest/preview/pipeline' },
  { key: 'watson', icon: '🔎', label: 'Ask Watson', href: '/guest/preview/watson' },
  { key: 'bars', icon: '⚖', label: 'Spot the risks', href: '/guest/preview/bars' },
] as const;

export type PreviewKey = typeof PREVIEWS[number]['key'];

// The three contextual messages come verbatim from the original request
// (via Prompt 526 Part B) — they are the copy that the approved email's own
// three CTAs promise, so a reworded version here would break the promise the
// email made. The test alongside this file asserts them character by
// character for exactly that reason.
export const PREVIEW_COPY: Record<PreviewKey, { title: string; message: string; source: string }> = {
  pipeline: {
    title: 'Find your next unicorn',
    message: 'Sign up to access a pipeline curated for your investment thesis.',
    source: 'pipeline_preview',
  },
  watson: {
    title: 'Ask Watson',
    // Watson NEVER runs for a guest — there is no fetch on these pages at
    // all, so there is nothing to gate at the API layer; the model is simply
    // never reached.
    message: 'Create an investor account to use Watson and get a private AI second opinion on your deals.',
    source: 'watson_preview',
  },
  bars: {
    title: 'Spot the risks others miss',
    message: 'Create an investor account to assess opportunities with BARS.',
    source: 'bars_preview',
  },
};

// Always the EXISTING signup flow (Prompt 526 is explicit that self-serve
// investor registration is out of scope). `source` is carried so that flow
// can one day return the guest to the screen they came from; nothing depends
// on it working today — it just isn't thrown away.
export function previewSignupHref(key: PreviewKey): string {
  return `/signup?as=investor&source=${PREVIEW_COPY[key].source}`;
}
