// Prompt 603 §C / Prompt 604 §A — whether the post-signup interstitial is
// switched on, and whether THIS founder has already seen it. Pure (no
// React, no I/O); the routes and the shell read it.
//
// Prompt 604 §A rewired registration. Prompt 603 had recorded ACCEPTANCE in
// `terms_acceptances` under a versioned row ('commitments-1.0') — the same
// table the real Terms & Conditions use. Nuno's correction: this page is
// advertising ("é apenas publicidade disfarçada, tipo 'nós damos, esta é a
// nossa forma de funcionar para tua segurança e conforto'"), not a second
// contract — the Terms are the contract, already accepted at signup, and
// reusing their table was exactly the confusion to avoid. It was also a live
// bug, confirmed by reading /api/terms/status: it reads terms_acceptances'
// LATEST row for the user REGARDLESS of version, so a commitments row (dated
// after a real Terms acceptance) would have shadowed it and silently
// re-gated the Terms screen the next time the founder needed it. Nobody was
// ever affected — the interstitial's own gate was off from day one, so zero
// such rows were ever written (checked in production before this change).
//
// Replaced by one boolean, `org_members.commitments_seen` (migration
// 20260912140000): a mark of "already seen", never an acceptance with a
// version. No per-commitment, per-version tracking — see content/
// commitments/v1.ts's own header for what that also let go of.
import { COMMITMENTS_V1, type Commitment } from '../content/commitments/v1';

export function getCommitments(): Commitment[] {
  return COMMITMENTS_V1;
}

/**
 * The interstitial is OFF until the text passes legal review and the open
 * questions (AI training, hosting region, the controller) are answered. Set
 * COMMITMENTS_GATE_ENABLED=1 in the environment to switch it on; the page
 * itself (/welcome/commitments) and the "mark as seen" route work either
 * way, so the review can be done on the real thing.
 */
export function commitmentsGateEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.COMMITMENTS_GATE_ENABLED === '1' || env.COMMITMENTS_GATE_ENABLED === 'true';
}

/** A signed-in founder, the gate on, who has not been marked as having seen it — nobody else. */
export function shouldShowCommitments(params: { gateEnabled: boolean; signedIn: boolean; isFounder: boolean; seen: boolean }): boolean {
  if (!params.gateEnabled || !params.signedIn || !params.isFounder) return false;
  return !params.seen;
}
