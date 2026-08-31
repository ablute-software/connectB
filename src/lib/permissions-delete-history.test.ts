// Prompt 503 §2 — quem pode apagar uma entrada do histórico de Readiness.
// Existe porque a premissa do prompt estava desactualizada: sugeria um
// `orgRole === 'owner'` à mão, a ler o enum de 0001_init.sql ('owner' |
// 'member'). A migração 0005 alargou-o e o enum VIVO é
// owner,member,admin,manager — verificado em produção antes de decidir. Este
// teste fixa a decisão que daí resulta (owner+admin, pela matriz que já
// existe) para não voltar a depender de uma leitura de um ficheiro só.
import { describe, expect, it } from 'vitest';
import { ORG_ROLES, can } from './permissions';

describe('delete_review_history', () => {
  it('deixa o owner e o admin apagarem — "quem administra a conta"', () => {
    expect(can('owner', 'delete_review_history')).toBe(true);
    expect(can('admin', 'delete_review_history')).toBe(true);
  });

  it('não deixa manager nem member', () => {
    expect(can('manager', 'delete_review_history')).toBe(false);
    expect(can('member', 'delete_review_history')).toBe(false);
  });

  it('não deixa quem não tem role nenhum (sessão sem org)', () => {
    expect(can(null, 'delete_review_history')).toBe(false);
    expect(can(undefined, 'delete_review_history')).toBe(false);
  });

  it('concede exactamente aos mesmos roles que as outras acções destrutivas', () => {
    const destructive = ORG_ROLES.filter((r) => can(r, 'delete_pipeline'));
    expect(ORG_ROLES.filter((r) => can(r, 'delete_review_history'))).toEqual(destructive);
  });
});
