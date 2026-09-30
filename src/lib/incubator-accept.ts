// Prompt I-01 §A.8 — accepting a startup invite, orchestrated. The
// relationship is created by incubator_accept_invite() (SQL, the caller's own
// session); the voucher, if the invite carries one, is redeemed afterwards
// through the same rules as /api/promo/redeem. A voucher that fails never
// undoes the relationship — the failure is returned to the screen instead.
// Pure orchestration with injected I/O, so the four outcomes the prompt
// names (invalid token, expired, already accepted, no org) and the
// "ineligible voucher does not block" rule are unit-testable.
import { incubatorErrorText } from './incubators';

export interface AcceptRpcResult {
  ok: boolean;
  error?: string;
  already?: boolean;
  relationship_id?: string;
  promo_code_id?: string | null;
  incubator_id?: string;
  org_id?: string;
}

export interface VoucherOutcome { ok: boolean; reason?: string }

export interface AcceptOutcome {
  ok: boolean;
  error?: string;
  message?: string;
  relationshipId?: string;
  already?: boolean;
  voucher?: { applied: boolean; message?: string } | null;
}

export const VOUCHER_NOT_APPLICABLE_TEXT = 'Voucher não aplicável ao teu plano — fala com a incubadora.';

export async function acceptIncubatorInvite(
  token: string,
  deps: {
    acceptRpc: (token: string) => Promise<AcceptRpcResult | null>;
    redeemVoucher: (promoCodeId: string, orgId: string) => Promise<VoucherOutcome>;
  },
): Promise<AcceptOutcome> {
  if (!token || token.length < 16) {
    return { ok: false, error: 'invite_not_found', message: incubatorErrorText('invite_not_found') };
  }
  const res = await deps.acceptRpc(token);
  if (!res) return { ok: false, error: 'unknown', message: incubatorErrorText(null) };
  if (!res.ok) return { ok: false, error: res.error, message: incubatorErrorText(res.error) };

  let voucher: AcceptOutcome['voucher'] = null;
  if (res.promo_code_id && res.org_id && !res.already) {
    try {
      const v = await deps.redeemVoucher(res.promo_code_id, res.org_id);
      voucher = v.ok ? { applied: true } : { applied: false, message: VOUCHER_NOT_APPLICABLE_TEXT };
    } catch {
      voucher = { applied: false, message: VOUCHER_NOT_APPLICABLE_TEXT };
    }
  }
  return { ok: true, relationshipId: res.relationship_id, already: !!res.already, voucher };
}
