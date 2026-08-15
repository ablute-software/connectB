import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { deliverMonthlyForOrg, type MonthlyDeliveryOrgRow } from './catalog-monthly-delivery-server';

// Prompt 201 — os travões antes de 1 de Setembro. A entrega mensal nunca
// tinha corrido em produção (nenhuma org com catalog_last_monthly_delivery),
// portanto isto é a primeira cobertura do caminho.
//
// Fake mínimo do query builder do supabase-js: encadeável, respostas por
// tabela, e regista TODOS os writes para os testes poderem afirmar sobre o
// que não foi escrito — que é o ponto do caso is_test.
function makeFakeAdmin(opts: {
  deliveredCount?: number;
  matches?: { catalog_id: string; score: number }[];
  catalogRows?: Record<string, unknown>[];
  ownedNames?: string[];
  updateReturnsRow?: boolean;
}) {
  const writes: { table: string; op: 'insert' | 'update'; payload: unknown }[] = [];
  const rpcCalls: { fn: string; args: unknown }[] = [];

  // O builder é *thenable*: no código real o await acontece no fim da cadeia
  // (`.select(...).eq(...).eq(...)`), não no .select(), portanto devolver a
  // resposta já no select deixava o count por entregar — e um teste em que o
  // tecto e o gap dão o mesmo número não notava. Resolver no `then` é o que
  // reproduz o encadeamento a sério.
  function resposta(table: string) {
    if (table === 'catalog_deliveries') return { count: opts.deliveredCount ?? 0, data: null, error: null };
    if (table === 'entities') return { data: (opts.ownedNames ?? []).map((name) => ({ name })), error: null };
    if (table === 'catalog_entities') return { data: opts.catalogRows ?? [], error: null };
    return { data: opts.updateReturnsRow === false ? null : { id: 'org-1' }, error: null };
  }

  function builder(table: string) {
    const b: Record<string, unknown> = {};
    const self = () => b as never;
    Object.assign(b, {
      select: self, eq: self, in: self, or: self, order: self,
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(resposta(table)).then(resolve),
      maybeSingle: () => Promise.resolve(resposta(table)),
      insert: (payload: unknown) => {
        writes.push({ table, op: 'insert', payload });
        return Promise.resolve({ data: null, error: null });
      },
      update: (payload: unknown) => { writes.push({ table, op: 'update', payload }); return self(); },
    });
    return b;
  }

  const admin = {
    from: (table: string) => builder(table),
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: opts.matches ?? [], error: null });
    },
  } as unknown as SupabaseClient;

  return { admin, writes, rpcCalls };
}

const NOW = '2026-09-01T09:00:00.000Z';

function catalogRow(id: string, name: string) {
  return {
    id, name, type: 'vc', hq_city: null, hq_country: 'PT', website: null,
    stage_min: null, stage_max: null, check_min_eur: null, check_max_eur: null,
    sectors: [], thesis: null,
  };
}

describe('deliverMonthlyForOrg — travões do Prompt 201', () => {
  // §2: uma org de teste sai antes de tudo. O que interessa não é o valor
  // devolvido, é não existir UM único write — nem quota, nem entities, nem
  // catalog_deliveries, nem enrichment_jobs.
  it('is_test: salta por completo, zero writes e zero rpc', async () => {
    const { admin, writes, rpcCalls } = makeFakeAdmin({ deliveredCount: 0, matches: [{ catalog_id: 'c1', score: 90 }] });
    const org: MonthlyDeliveryOrgRow = {
      id: 'org-test', plan: 'motherfunding', catalog_quota: 40, catalog_last_monthly_delivery: null, is_test: true,
    };

    const result = await deliverMonthlyForOrg(admin, org, NOW);

    expect(result.ran).toBe(false);
    expect(result.reason).toContain('is_test');
    expect(writes).toEqual([]);
    expect(rpcCalls).toEqual([]);
    expect(result.newQuota).toBeUndefined();
  });

  // §1: o caso que motivou o prompt. Quota inflacionada (40) com consumo real
  // quase nulo (1) daria pLimit=49 pela fórmula antiga; tem de dar 10, o
  // incremento do plano idea. É exactamente o ablute_ em produção.
  it('tecto: entrega o incremento, nao o buraco todo entre quota e consumido', async () => {
    const matches = Array.from({ length: 50 }, (_, i) => ({ catalog_id: `c${i}`, score: 100 - i }));
    const { admin, rpcCalls } = makeFakeAdmin({
      deliveredCount: 1, matches,
      catalogRows: matches.map((m, i) => catalogRow(m.catalog_id, `Fundo ${i}`)),
    });
    const org: MonthlyDeliveryOrgRow = {
      id: 'org-1', plan: 'idea', catalog_quota: 40, catalog_last_monthly_delivery: null, is_test: false,
    };

    const result = await deliverMonthlyForOrg(admin, org, NOW);

    expect(result.newQuota).toBe(50);                                   // a quota cresce na mesma
    expect((rpcCalls[0].args as { p_limit: number }).p_limit).toBe(10); // mas só saem 10
  });

  // §1, o outro lado: uma org real e em dia (consumo colado à quota) não pode
  // ser penalizada pelo tecto — continua a receber o incremento inteiro.
  it('caso normal: org sem atraso acumulado recebe o incremento certo', async () => {
    const matches = Array.from({ length: 30 }, (_, i) => ({ catalog_id: `c${i}`, score: 100 - i }));
    const { admin, rpcCalls } = makeFakeAdmin({
      deliveredCount: 40, matches,
      catalogRows: matches.map((m, i) => catalogRow(m.catalog_id, `Fundo ${i}`)),
    });
    const org: MonthlyDeliveryOrgRow = {
      id: 'org-2', plan: 'motherfunding', catalog_quota: 40, catalog_last_monthly_delivery: null, is_test: false,
    };

    const result = await deliverMonthlyForOrg(admin, org, NOW);

    expect(result.newQuota).toBe(90);
    expect((rpcCalls[0].args as { p_limit: number }).p_limit).toBe(50);
  });

  // O tecto é um mínimo, não uma substituição: quando o gap real é MENOR que
  // o incremento, manda o gap (senão entregava acima da quota).
  it('quando o gap e menor que o incremento, manda o gap', async () => {
    const { admin, rpcCalls } = makeFakeAdmin({ deliveredCount: 46, matches: [] });
    const org: MonthlyDeliveryOrgRow = {
      id: 'org-3', plan: 'idea', catalog_quota: 40, catalog_last_monthly_delivery: null, is_test: false,
    };

    await deliverMonthlyForOrg(admin, org, NOW);

    expect((rpcCalls[0].args as { p_limit: number }).p_limit).toBe(4); // 50 - 46
  });

  it('org sem is_test definido e tratada como real (compatibilidade)', async () => {
    const { admin, rpcCalls } = makeFakeAdmin({ deliveredCount: 0, matches: [] });
    const org: MonthlyDeliveryOrgRow = {
      id: 'org-4', plan: 'idea', catalog_quota: 3, catalog_last_monthly_delivery: null,
    };

    const result = await deliverMonthlyForOrg(admin, org, NOW);

    expect(result.ran).toBe(true);
    expect((rpcCalls[0].args as { p_limit: number }).p_limit).toBe(10);
  });
});
