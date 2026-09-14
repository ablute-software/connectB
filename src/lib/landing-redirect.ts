// Prompt 515 — where a logged-in visitor to a PUBLIC landing page gets sent.
//
// Both public landings (`/` and `/investors`) had the same line, copied:
//
//     redirect(role === 'investor' ? '/portal' : '/pipeline')
//
// A ternary over a four-value union only branches on two of them. 'founder'
// and 'developer' belong on /pipeline, but so did 'none' — a real, reachable
// state (an authenticated session with no platform_admins row, no org_members
// row and no matching access_grants; e.g. someone who signed in expecting
// investor access that was never granted). That account was pushed into the
// founder app, which renders an empty shell for it with no explanation of
// why. Reported in production, 01/09/2026.
//
// 'none' has no home on the platform, so it gets the public landing every
// other visitor gets: null here means "render the page, don't redirect".
// Sending it to /portal instead would only replay /portal's own no-access
// dead end on every single visit to sherlockdeal.com.
import type { Role } from './supabase';

// Prompt 587 — 'investor_pending' (a submitted claim that didn't
// auto-approve and hasn't been decided by an admin yet) gets its own
// destination, same reasoning as 'none' getting the public landing instead
// of the founder shell: /claim/pending explains what's happening and what's
// still needed, instead of either the marketing page or /portal's own
// no-access dead end.
export function landingDestination(role: Role): '/portal' | '/pipeline' | '/claim/pending' | null {
  switch (role) {
    case 'investor':
      return '/portal';
    case 'founder':
    case 'developer':
      return '/pipeline';
    case 'investor_pending':
      return '/claim/pending';
    case 'none':
      return null;
  }
}
