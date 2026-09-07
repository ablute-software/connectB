// Prompt 603 §C — which commitments version is current, and whether the
// post-signup interstitial is switched on. Pure (no React, no I/O); the
// routes and the shell read it.
//
// Acceptance is recorded in the existing terms_acceptances table under a
// namespaced version ('commitments-1.0'), so one table proves what each
// person accepted and when, for both documents, with the existing
// (user_id, version) key doing the idempotency.
import { COMMITMENTS_V1, type Commitment } from '../content/commitments/v1';

export const COMMITMENTS_VERSION = 'commitments-1.0';

const BY_VERSION: Record<string, Commitment[]> = { [COMMITMENTS_VERSION]: COMMITMENTS_V1 };

export function getCommitments(version: string = COMMITMENTS_VERSION): Commitment[] {
  return BY_VERSION[version] ?? BY_VERSION[COMMITMENTS_VERSION];
}

/**
 * The interstitial is OFF until the text passes legal review and the three
 * open answers of the prompt (AI training, hosting region, controller) are
 * in. Set COMMITMENTS_GATE_ENABLED=1 in the environment to switch it on; the
 * page itself (/welcome/commitments) and the acceptance route work either
 * way, so the review can be done on the real thing.
 */
export function commitmentsGateEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.COMMITMENTS_GATE_ENABLED === '1' || env.COMMITMENTS_GATE_ENABLED === 'true';
}

/** Same shape as shouldGateTerms: signed-in founder whose latest accepted commitments version is not the current one. */
export function shouldGateCommitments(params: { gateEnabled: boolean; signedIn: boolean; isFounder: boolean; acceptedVersion: string | null }, current: string = COMMITMENTS_VERSION): boolean {
  if (!params.gateEnabled || !params.signedIn || !params.isFounder) return false;
  return params.acceptedVersion !== current;
}

export function isCommitmentsVersion(version: string): boolean {
  return version.startsWith('commitments-');
}
