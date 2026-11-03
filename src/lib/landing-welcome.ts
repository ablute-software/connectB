// Nuno, 03/11/2026: the account buttons that start the sign-up ("Create account", "Claim your profile") play a short welcome while the landing fades, and the sign-up page opens when it ends.
// Only those two buttons: the plans' "Start free" and the others keep their plain link.
export const WELCOME_SOUND = '/landing/welcome.mp3';
/** If the sound has not ended by then (blocked, never loaded), the sign-up opens anyway. */
export const WELCOME_FALLBACK_MS = 8000;
const LABELS = ['create account', 'claim your profile'];
const TARGETS = ['/signup', '/claim'];

export function isWelcomeLink(href: string | null, text: string | null): boolean {
  if (!href || !TARGETS.includes(href)) return false;
  return LABELS.includes((text ?? '').trim().replace(/\s+/g, ' ').toLowerCase());
}
