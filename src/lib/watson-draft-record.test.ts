import { describe, expect, it, vi, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordWatsonDraft } from './watson-draft-record';

// Prompt 203 §A. O que importa aqui não é o valor de retorno por si: é que
// uma falha do RPC NÃO rebenta o fluxo (o founder fica com o draft) e ao
// mesmo tempo deixa de ser muda. Antes disto era `.then(() => {}, () => {})`
// — consumo por registar e ninguém a saber.

function fakeSb(result: { error: { message: string } | null }) {
  const calls: { fn: string; args: unknown }[] = [];
  const sb = {
    rpc: (fn: string, args: unknown) => { calls.push({ fn, args }); return Promise.resolve(result); },
  } as unknown as SupabaseClient;
  return { sb, calls };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('recordWatsonDraft', () => {
  it('sucesso: devolve true e chama o rpc com org e quota', async () => {
    const { sb, calls } = fakeSb({ error: null });

    await expect(recordWatsonDraft(sb, 'org-1', 20)).resolves.toBe(true);
    expect(calls).toEqual([{ fn: 'watson_record_draft', args: { p_org_id: 'org-1', p_quota: 20 } }]);
  });

  it('falha: devolve false SEM lancar -- o draft nao se perde', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { sb } = fakeSb({ error: { message: 'network unreachable' } });

    await expect(recordWatsonDraft(sb, 'org-1', 20)).resolves.toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('falha: o log leva orgId e a mensagem, para ser reconciliavel depois', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { sb } = fakeSb({ error: { message: 'deadlock detected' } });

    await recordWatsonDraft(sb, 'org-42', 5);

    const [msg, ctx] = spy.mock.calls[0];
    expect(String(msg)).toContain('watson_record_draft');
    expect(ctx).toEqual({ orgId: 'org-42', error: 'deadlock detected' });
  });

  it('sucesso nao escreve nada no log', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { sb } = fakeSb({ error: null });

    await recordWatsonDraft(sb, 'org-1', 20);

    expect(spy).not.toHaveBeenCalled();
  });
});
