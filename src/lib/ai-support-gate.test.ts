import { describe, expect, it } from 'vitest';
import { hasCompletedBlueprintAnalysis } from './ai-support-gate';

describe('hasCompletedBlueprintAnalysis — o mesmo sinal do Blueprint/Readiness & Train, nunca um segundo', () => {
  it('nenhuma análise -> false, nunca sugere sem matéria', () => {
    expect(hasCompletedBlueprintAnalysis([])).toBe(false);
  });

  it('só análises in_progress/abandoned -> false', () => {
    expect(hasCompletedBlueprintAnalysis([{ status: 'in_progress' }, { status: 'abandoned' }])).toBe(false);
  });

  it('pelo menos uma completed -> true, mesmo que não seja a mais recente', () => {
    expect(hasCompletedBlueprintAnalysis([{ status: 'in_progress' }, { status: 'completed' }])).toBe(true);
  });

  it('a org certa: chamador filtra por org_id antes de passar as linhas aqui — esta função não sabe de orgs', () => {
    // Documenta a fronteira: hasCompletedBlueprintAnalysis só decide sobre
    // as linhas que recebe — a query .eq('org_id', orgId) é responsabilidade
    // do chamador (a rota), nunca desta função pura.
    expect(hasCompletedBlueprintAnalysis([{ status: 'completed' }])).toBe(true);
  });
});
