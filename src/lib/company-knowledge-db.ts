import 'server-only';
// Prompt 219 bloco 3 §1 (Prompt 223) — o adaptador: vai buscar as linhas que
// o mapper puro (company-knowledge.ts) sabe converter. Sem lógica de
// negócio própria — se algo aqui precisar de uma decisão, a decisão
// pertence ao ficheiro puro, onde há testes.
//
// A lista de tabelas lidas É a garantia da regra raiz, e por isso está
// fechada e comentada: company_facts, orgs (campos de perfil e do ask),
// funding_rounds, company_roadmap_milestones (+roadmap_categories),
// company_people e review_clarifications. NENHUMA leitura de interactions,
// entities, tasks ou seja o que for de pipeline — ver o cabeçalho de
// company-knowledge.ts.
//
// Prompt 311 §A — documents/folders deixaram de entrar nesta leitura:
// existiam só para alimentar documentToAtom (removido), que materializava
// um claim por ficheiro do Vault. hasAnyVaultDocument, abaixo, é a leitura
// directa que o substitui — mais barata (um count, não o join com pastas) e
// sem gerar linha nenhuma em company_claims.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { KnowledgeSources } from './company-knowledge';
import type { CompanyClaim, ClaimCategory, ClaimSpecificity, ClaimSourceKind, ClaimStatus, EvidenceClass } from './types';

export async function readKnowledgeSources(admin: SupabaseClient, orgId: string): Promise<KnowledgeSources> {
  const [facts, org, fundingRounds, milestones, roadmapCategories, people, clarifications] = await Promise.all([
    admin.from('company_facts').select('id, category, statement, status, confirmed_at, updated_at').eq('org_id', orgId),
    admin.from('orgs').select('one_liner, description, sectors, sectors_other, stage, country, founded_year, revenue_eur, round_target_eur, round_use_of_funds, round_instruments, round_valuation_eur').eq('id', orgId).maybeSingle(),
    admin.from('funding_rounds').select('id, label, amount_eur, closed_year, note').eq('org_id', orgId),
    admin.from('company_roadmap_milestones').select('id, period_kind, period_year, period_quarter, items, items_v2').eq('org_id', orgId).order('period_year', { ascending: true }),
    admin.from('roadmap_categories').select('id, label').eq('org_id', orgId),
    admin.from('company_people').select('id, full_name, title, is_founder, bio').eq('org_id', orgId).order('sort_order', { ascending: true }),
    admin.from('review_clarifications').select('id, category, item_text, clarification_text, updated_at').eq('org_id', orgId),
  ]);

  return {
    facts: (facts.data ?? []) as KnowledgeSources['facts'],
    org: (org.data ?? null) as KnowledgeSources['org'],
    fundingRounds: (fundingRounds.data ?? []) as KnowledgeSources['fundingRounds'],
    milestones: (milestones.data ?? []) as KnowledgeSources['milestones'],
    roadmapCategories: (roadmapCategories.data ?? []) as KnowledgeSources['roadmapCategories'],
    people: (people.data ?? []) as KnowledgeSources['people'],
    clarifications: (clarifications.data ?? []) as KnowledgeSources['clarifications'],
  };
}

// Prompt 311 §A — o que G4 (company-gaps.ts) precisa para "há documento no
// Vault?", lido directamente em vez de via um claim materializado por
// ficheiro. Um único .limit(1): não interessa QUANTOS documentos existem,
// só se existe algum.
//
// Limitação conhecida e aceite (revisão adversarial): não filtra por
// malware_scan_status, ao contrário de quem lê CONTEÚDO de documentos
// (gap-assist/route.ts). Aqui só interessa presença como sinal aproximado
// de "o founder já usa o Vault" — nunca o conteúdo é lido ou exposto — e o
// pior cenário (o ÚNICO documento da org estar 'flagged') só evita uma
// pergunta G4 de prova_tecnica, nunca expõe nada. Não vale a complexidade de
// um filtro OR sobre um valor que pode ser NULL só para este caso raro.
export async function hasAnyVaultDocument(admin: SupabaseClient, orgId: string): Promise<boolean> {
  const { data } = await admin.from('documents').select('id').eq('org_id', orgId).limit(1);
  return (data?.length ?? 0) > 0;
}

// Os claims que já existem para esta org — para não voltar a propor o que o
// founder já aceitou ou já rejeitou (newAtoms, no ficheiro puro).
export async function readExistingClaims(admin: SupabaseClient, orgId: string): Promise<CompanyClaim[]> {
  const { data } = await admin.from('company_claims')
    .select('id, category, statement, evidence_class, specificity, source_kind, source_ref, status, updated_at')
    .eq('org_id', orgId).order('created_at', { ascending: true });
  return (data ?? []).map((c) => ({
    id: c.id as string,
    category: c.category as ClaimCategory,
    statement: c.statement as string,
    evidenceClass: c.evidence_class as EvidenceClass,
    specificity: c.specificity as ClaimSpecificity,
    sourceKind: c.source_kind as ClaimSourceKind,
    sourceRef: (c.source_ref as string | null) ?? null,
    status: c.status as ClaimStatus,
    updatedAt: c.updated_at as string,
  }));
}
