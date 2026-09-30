// Prompt I-01 §B.3/§D — resolveIncubatorAccess: a tabela estado × nível →
// acesso, com um cliente Supabase falso (o padrão de portal-access.test.ts).
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveIncubatorAccess, resolveIncubatorMember } from './incubator-access-core';

type Row = Record<string, unknown>;

// Minimal chainable fake: every filter narrows `rows`; order()/maybeSingle()
// resolve. Fails loudly on a table the gate should never read.
function fakeClient(tables: Record<string, Row[]>): SupabaseClient {
  const from = (table: string) => {
    if (!(table in tables)) throw new Error(`gate read an unexpected table: ${table}`);
    let rows = [...tables[table]];
    const api = {
      select: () => api,
      eq: (col: string, v: unknown) => { rows = rows.filter((r) => r[col] === v); return api; },
      neq: (col: string, v: unknown) => { rows = rows.filter((r) => r[col] !== v); return api; },
      order: () => Promise.resolve({ data: rows, error: null }),
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: rows.length > 1 ? { message: 'multiple' } : null }),
    };
    return api;
  };
  return { from } as unknown as SupabaseClient;
}

const MEMBER = { id: 'm1', incubator_id: 'inc1', user_id: 'u1', status: 'active', role: 'manager', created_at: '2026-09-01', incubators: { name: 'Inc', closed_at: null } };

describe('resolveIncubatorMember', () => {
  it('membro activo de incubadora aberta', async () => {
    const m = await resolveIncubatorMember(fakeClient({ incubator_members: [MEMBER] }), 'u1');
    expect(m).toEqual({ id: 'm1', incubatorId: 'inc1', role: 'manager', incubatorName: 'Inc' });
  });
  it('incubadora fechada → null', async () => {
    const closed = { ...MEMBER, incubators: { name: 'Inc', closed_at: '2026-09-20' } };
    expect(await resolveIncubatorMember(fakeClient({ incubator_members: [closed] }), 'u1')).toBeNull();
  });
  it('membro removido/convidado → null', async () => {
    expect(await resolveIncubatorMember(fakeClient({ incubator_members: [{ ...MEMBER, status: 'removed' }] }), 'u1')).toBeNull();
    expect(await resolveIncubatorMember(fakeClient({ incubator_members: [{ ...MEMBER, status: 'invited' }] }), 'u1')).toBeNull();
  });
});

describe('resolveIncubatorAccess — estado × nível', () => {
  const rel = (status: string, level: number) => ({ id: 'r1', incubator_id: 'inc1', org_id: 'org1', status, sharing_level: level });

  it.each([
    ['active', 1, 1], ['active', 2, 2], ['graduated', 1, 1], ['active', 0, 0],
  ])('%s nível %i → acesso ao nível %i', async (status, level, expected) => {
    const a = await resolveIncubatorAccess(fakeClient({ incubator_members: [MEMBER], incubator_relationships: [rel(status as string, level as number)] }), 'u1', 'org1');
    expect(a?.level).toBe(expected);
    expect(a?.relationship.id).toBe('r1');
  });

  it.each([['paused'], ['ended']])('%s → null (sem período de graça)', async (status) => {
    const a = await resolveIncubatorAccess(fakeClient({ incubator_members: [MEMBER], incubator_relationships: [rel(status, 2)] }), 'u1', 'org1');
    expect(a).toBeNull();
  });

  it('org de outra incubadora → null', async () => {
    const other = { ...rel('active', 2), incubator_id: 'inc2' };
    expect(await resolveIncubatorAccess(fakeClient({ incubator_members: [MEMBER], incubator_relationships: [other] }), 'u1', 'org1')).toBeNull();
  });

  it('não-membro → null, sem ler relações', async () => {
    expect(await resolveIncubatorAccess(fakeClient({ incubator_members: [] }), 'u1', 'org1')).toBeNull();
  });

  it('nunca lê tabelas do founder (orgs, entities, documents, access_grants)', async () => {
    // fakeClient throws on any table not listed — reaching the end proves it.
    await resolveIncubatorAccess(fakeClient({ incubator_members: [MEMBER], incubator_relationships: [rel('active', 1)] }), 'u1', 'org1');
  });
});
