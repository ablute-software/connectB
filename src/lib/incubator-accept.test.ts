// Prompt I-01 §D — aceitação de convite: token inválido, expirado, já
// aceite, utilizador sem org, e voucher inelegível que NÃO bloqueia a relação.
import { describe, expect, it, vi } from 'vitest';
import { acceptIncubatorInvite, VOUCHER_NOT_APPLICABLE_TEXT, type AcceptRpcResult } from './incubator-accept';
import { incubatorErrorText } from './incubators';

const TOKEN = 'x'.repeat(43);

function deps(rpc: AcceptRpcResult | null, voucher: { ok: boolean; reason?: string } | Error = { ok: true }) {
  return {
    acceptRpc: vi.fn(async () => rpc),
    redeemVoucher: vi.fn(async () => { if (voucher instanceof Error) throw voucher; return voucher; }),
  };
}

describe('acceptIncubatorInvite', () => {
  it('token vazio/curto → invite_not_found, sem chamar o SQL', async () => {
    const d = deps({ ok: true });
    const r = await acceptIncubatorInvite('abc', d);
    expect(r).toMatchObject({ ok: false, error: 'invite_not_found' });
    expect(d.acceptRpc).not.toHaveBeenCalled();
  });

  it.each([
    ['invite_not_found'], ['invite_expired'], ['invite_already_accepted'], ['no_open_org'], ['invite_revoked'], ['incubator_closed'],
  ])('erro do SQL %s → mensagem certa, sem voucher', async (code) => {
    const d = deps({ ok: false, error: code });
    const r = await acceptIncubatorInvite(TOKEN, d);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(code);
    expect(r.message).toBe(incubatorErrorText(code));
    expect(d.redeemVoucher).not.toHaveBeenCalled();
  });

  it('sem voucher → relação criada, voucher null', async () => {
    const d = deps({ ok: true, relationship_id: 'rel-1', promo_code_id: null, org_id: 'org-1', already: false });
    const r = await acceptIncubatorInvite(TOKEN, d);
    expect(r).toEqual({ ok: true, relationshipId: 'rel-1', already: false, voucher: null });
    expect(d.redeemVoucher).not.toHaveBeenCalled();
  });

  it('voucher elegível → aplicado', async () => {
    const d = deps({ ok: true, relationship_id: 'rel-1', promo_code_id: 'promo-1', org_id: 'org-1' }, { ok: true });
    const r = await acceptIncubatorInvite(TOKEN, d);
    expect(r.ok).toBe(true);
    expect(r.voucher).toEqual({ applied: true });
    expect(d.redeemVoucher).toHaveBeenCalledWith('promo-1', 'org-1');
  });

  it('voucher inelegível NÃO bloqueia a relação — a falha vai para o ecrã', async () => {
    const d = deps({ ok: true, relationship_id: 'rel-1', promo_code_id: 'promo-1', org_id: 'org-1' }, { ok: false, reason: 'expired' });
    const r = await acceptIncubatorInvite(TOKEN, d);
    expect(r.ok).toBe(true);
    expect(r.relationshipId).toBe('rel-1');
    expect(r.voucher).toEqual({ applied: false, message: VOUCHER_NOT_APPLICABLE_TEXT });
  });

  it('resgate que rebenta também não bloqueia a relação', async () => {
    const d = deps({ ok: true, relationship_id: 'rel-1', promo_code_id: 'promo-1', org_id: 'org-1' }, new Error('boom'));
    const r = await acceptIncubatorInvite(TOKEN, d);
    expect(r.ok).toBe(true);
    expect(r.voucher?.applied).toBe(false);
  });

  it('idempotente: aceitar outra vez devolve a relação existente e não tenta o voucher de novo', async () => {
    const d = deps({ ok: true, already: true, relationship_id: 'rel-1', promo_code_id: 'promo-1', org_id: 'org-1' });
    const r = await acceptIncubatorInvite(TOKEN, d);
    expect(r).toMatchObject({ ok: true, already: true, relationshipId: 'rel-1', voucher: null });
    expect(d.redeemVoucher).not.toHaveBeenCalled();
  });

  it('RPC sem resposta → erro genérico', async () => {
    const r = await acceptIncubatorInvite(TOKEN, deps(null));
    expect(r.ok).toBe(false);
  });
});
