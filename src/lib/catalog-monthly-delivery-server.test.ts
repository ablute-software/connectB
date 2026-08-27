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
  // Prompt 407 — claimed-profile-precedence fixtures. Each is empty by
  // default (see resposta() below), so existing tests that don't set
  // these up keep exercising the "nothing claimed" path unchanged.
  claims?: { catalog_entity_id: string; claimant_user_id: string; status: string }[];
  members?: { id: string; catalog_entity_id: string; user_id: string }[];
  profiles?: Record<string, unknown>[];
}) {
  const writes: { table: string; op: 'insert' | 'update'; payload: unknown }[] = [];
  const rpcCalls: { fn: string; args: unknown }[] = [];

  // O builder é *thenable*: no código real o await acontece no fim da cadeia
  // (`.select(...).eq(...).eq(...)`), não no .select(), portanto devolver a
  // resposta já no select deixava o count por entregar — e um teste em que o
  // tecto e o gap dão o mesmo número não notava. Resolver no `then` é o que
  // reproduz o encadeamento a sério.
  // Prompt 407 — the three tables resolveClaimedInvestorProfile reads,
  // genuinely filtered by the .eq()/.in() calls the real code makes (col
  // === val / col in vals) — unlike the other tables below, whose tests
  // never depend on filtering and use a single fixed fixture per table.
  const FILTERED_TABLES: Record<string, Record<string, unknown>[] | undefined> = {
    investor_entity_claims: opts.claims, matchdeal_investor_members: opts.members, matchdeal_profiles: opts.profiles,
  };

  function resposta(table: string, filters: [string, unknown, 'eq' | 'in'][]) {
    if (table in FILTERED_TABLES) {
      const rows = (FILTERED_TABLES[table] ?? []).filter((row) =>
        filters.every(([col, val, kind]) => (kind === 'eq' ? row[col] === val : (val as unknown[]).includes(row[col]))));
      return { data: rows, error: null };
    }
    if (table === 'catalog_deliveries') return { count: opts.deliveredCount ?? 0, data: null, error: null };
    if (table === 'entities') return { data: (opts.ownedNames ?? []).map((name) => ({ name })), error: null };
    if (table === 'catalog_entities') return { data: opts.catalogRows ?? [], error: null };
    return { data: opts.updateReturnsRow === false ? null : { id: 'org-1' }, error: null };
  }

  function builder(table: string) {
    const b: Record<string, unknown> = {};
    const self = () => b as never;
    const filters: [string, unknown, 'eq' | 'in'][] = [];
    Object.assign(b, {
      select: self,
      eq: (col: string, val: unknown) => { filters.push([col, val, 'eq']); return self(); },
      in: (col: string, val: unknown) => { filters.push([col, val, 'in']); return self(); },
      or: self, order: self, limit: self,
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(resposta(table, filters)).then(resolve),
      maybeSingle: () => {
        const r = resposta(table, filters) as { data: unknown[] | null; error: null };
        // Real .maybeSingle() collapses a filtered array response down to
        // one row (or null) — only reachable here via the FILTERED_TABLES
        // path (matchdeal_profiles' own final .maybeSingle()); the other
        // tables' maybeSingle() callers (the quota UPDATE) don't go through
        // resposta's array shape at all, so this never affects them.
        if (Array.isArray(r.data)) return Promise.resolve({ data: r.data[0] ?? null, error: null });
        return Promise.resolve(r);
      },
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

function catalogRow(id: string, name: string): Record<string, unknown> {
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

// Prompt 407 §A/§B.1 — the claim/is_complete gate applied at the exact
// point catalog data becomes a founder's own entities row.
describe('deliverMonthlyForOrg — Prompt 407 claimed-profile precedence', () => {
  const claimedRow = catalogRow('c1', 'zz-test-claimed-vc');
  claimedRow.website = 'https://researched-guess.example';
  claimedRow.sectors = ['fintech'];
  claimedRow.thesis = 'Researched thesis text.';
  claimedRow.check_min_eur = 50000;
  claimedRow.check_max_eur = 200000;

  function baseOrg(id: string): MonthlyDeliveryOrgRow {
    return { id, plan: 'idea', catalog_quota: 0, catalog_last_monthly_delivery: null, is_test: false };
  }

  it('qualifies: approved claim + is_complete profile — declared fields win, empty ones fall back', async () => {
    const { admin, writes } = makeFakeAdmin({
      deliveredCount: 0, matches: [{ catalog_id: 'c1', score: 90 }], catalogRows: [claimedRow],
      claims: [{ catalog_entity_id: 'c1', claimant_user_id: 'u1', status: 'approved' }],
      members: [{ id: 'm1', catalog_entity_id: 'c1', user_id: 'u1' }],
      profiles: [{
        membership_id: 'm1', kind: 'investor', is_complete: true, updated_at: '2026-08-01T00:00:00Z',
        website: 'https://declared.example', sectors: ['healthtech', 'deeptech'],
        description: '', // declared but empty — must fall back to the researched thesis
        ticket_min: 100000, ticket_max: null, // declared max is empty — must fall back
        stages_invested: [], geographies: [], contact: null, preferred_contact_channel: null,
        representative_name: null, entity_name: null,
      }],
    });

    await deliverMonthlyForOrg(admin, baseOrg('org-claimed'), NOW);

    const insertedEntity = writes.find((w) => w.table === 'entities')!.payload as Record<string, unknown>[];
    const e = insertedEntity[0];
    expect(e.website).toBe('https://declared.example');
    expect(e.sectors).toEqual(['healthtech', 'deeptech']);
    expect(e.thesis).toBe('Researched thesis text.'); // empty declared description -> researched
    expect(e.check_min_eur).toBe(100000);
    expect(e.check_max_eur).toBe(200000); // empty declared max -> researched
  });

  it('does not qualify: no approved claim — every field stays researched, exactly as before', async () => {
    const { admin, writes } = makeFakeAdmin({
      deliveredCount: 0, matches: [{ catalog_id: 'c1', score: 90 }], catalogRows: [claimedRow],
      claims: [], members: [], profiles: [],
    });

    await deliverMonthlyForOrg(admin, baseOrg('org-unclaimed'), NOW);

    const insertedEntity = writes.find((w) => w.table === 'entities')!.payload as Record<string, unknown>[];
    const e = insertedEntity[0];
    expect(e.website).toBe('https://researched-guess.example');
    expect(e.sectors).toEqual(['fintech']);
    expect(e.thesis).toBe('Researched thesis text.');
    expect(e.check_min_eur).toBe(50000);
    expect(e.check_max_eur).toBe(200000);
  });

  it('does not qualify: claim approved but profile is_complete=false — still all researched', async () => {
    const { admin, writes } = makeFakeAdmin({
      deliveredCount: 0, matches: [{ catalog_id: 'c1', score: 90 }], catalogRows: [claimedRow],
      claims: [{ catalog_entity_id: 'c1', claimant_user_id: 'u1', status: 'approved' }],
      members: [{ id: 'm1', catalog_entity_id: 'c1', user_id: 'u1' }],
      profiles: [{ membership_id: 'm1', kind: 'investor', is_complete: false, updated_at: '2026-08-01T00:00:00Z', website: 'https://declared.example' }],
    });

    await deliverMonthlyForOrg(admin, baseOrg('org-incomplete'), NOW);

    const insertedEntity = writes.find((w) => w.table === 'entities')!.payload as Record<string, unknown>[];
    expect(insertedEntity[0].website).toBe('https://researched-guess.example');
  });

  it('does not qualify: claim exists but still pending (not approved) — still all researched', async () => {
    const { admin, writes } = makeFakeAdmin({
      deliveredCount: 0, matches: [{ catalog_id: 'c1', score: 90 }], catalogRows: [claimedRow],
      claims: [{ catalog_entity_id: 'c1', claimant_user_id: 'u1', status: 'pending' }],
      members: [{ id: 'm1', catalog_entity_id: 'c1', user_id: 'u1' }],
      profiles: [{ membership_id: 'm1', kind: 'investor', is_complete: true, updated_at: '2026-08-01T00:00:00Z', website: 'https://declared.example' }],
    });

    await deliverMonthlyForOrg(admin, baseOrg('org-pending'), NOW);

    const insertedEntity = writes.find((w) => w.table === 'entities')!.payload as Record<string, unknown>[];
    expect(insertedEntity[0].website).toBe('https://researched-guess.example');
  });
});
