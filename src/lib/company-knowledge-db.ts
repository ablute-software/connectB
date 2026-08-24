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
import type { CompanyClaim, ClaimCategory, ClaimSpecificity, ClaimSourceKind, ClaimStatus, EvidenceClass, DocumentRef } from './types';
import { documentRefsAvailable, gapDispositionAvailable } from './document-extraction-capability';

export async function readKnowledgeSources(admin: SupabaseClient, orgId: string): Promise<KnowledgeSources> {
  const [facts, org, fundingRounds, milestones, roadmapCategories, people, clarifications] = await Promise.all([
    admin.from('company_facts').select('id, category, statement, status, confirmed_at, updated_at').eq('org_id', orgId),
    admin.from('orgs').select('one_liner, description, sectors, sectors_other, stage, country, founded_year, revenue_eur, round_target_eur, round_use_of_funds, round_instruments, round_valuation_eur').eq('id', orgId).maybeSingle(),
    admin.from('funding_rounds').select('id, label, amount_eur, closed_year, note, investor_name').eq('org_id', orgId),
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
//
// Prompt 313 §B — document_refs só entra no select depois de confirmado por
// documentRefsAvailable(): a 0208 pode ainda não estar aplicada num
// ambiente que já tem company_claims (0176) há muito tempo, e um select por
// uma coluna inexistente rebentava a funcionalidade INTEIRA do Blueprint,
// não só a parte nova. Degradar para documentRefs: [] é honesto — nunca
// finge um link que não existe.
export async function readExistingClaims(admin: SupabaseClient, orgId: string): Promise<CompanyClaim[]> {
  const withDocumentRefs = await documentRefsAvailable();
  // Two separate literal .select() calls, not one string built from a
  // ternary: postgrest-js infers the result row type from the SELECT
  // string's own literal TYPE, not its runtime value — a variable holding
  // either literal widens to plain `string`, which the parser can't type at
  // all (confirmed: that shape fails tsc with a ParserError on every field).
  const { data } = withDocumentRefs
    ? await admin.from('company_claims')
      .select('id, category, statement, evidence_class, specificity, source_kind, source_ref, status, updated_at, document_refs')
      .eq('org_id', orgId).order('created_at', { ascending: true })
    : await admin.from('company_claims')
      .select('id, category, statement, evidence_class, specificity, source_kind, source_ref, status, updated_at')
      .eq('org_id', orgId).order('created_at', { ascending: true });
  // Prompt 358 Phase 1 — a separate, lightweight query rather than a THIRD
  // select-string branch: gapDispositionAvailable is orthogonal to
  // withDocumentRefs (they shipped in different migrations), and the
  // "two literal select strings" constraint above already means adding a
  // second independent toggle would require FOUR literal branches. Merging
  // by id after a plain id+gap_disposition fetch is simpler and no less
  // correct.
  const withGapDisposition = await gapDispositionAvailable();
  const gapDispositionById = new Map<string, string | null>();
  if (withGapDisposition && (data ?? []).length > 0) {
    const { data: dispositionRows } = await admin.from('company_claims')
      .select('id, gap_disposition').eq('org_id', orgId);
    for (const r of dispositionRows ?? []) gapDispositionById.set(r.id as string, (r.gap_disposition as string | null) ?? null);
  }

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
    documentRefs: withDocumentRefs ? (((c as unknown as { document_refs?: DocumentRef[] }).document_refs) ?? []) : [],
    gapDisposition: (gapDispositionById.get(c.id as string) ?? null) as CompanyClaim['gapDisposition'],
  }));
}
