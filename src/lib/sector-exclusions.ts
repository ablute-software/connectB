// Prompt 200 §C — exclusões de sector do investidor ("Does not invest in").
// Até aqui o campo era decorativo: exclusions_sectors/exclusions_notes só
// eram lidos por MatchDealDeck.tsx para desenhar a etiqueta, e nunca por
// nada que filtrasse. Isto é o filtro — regra de negócio nova, não um
// ajuste a matching existente.
//
// Decisão (Nuno, 2026-08-15): hard filter, nos dois sítios. Uma exclusão
// elimina a startup, não lhe baixa o score — "does not invest in foodtech" é
// uma declaração do investidor, não uma preferência. Aplica-se ao scoring
// (investor-match-score.ts) e ao deck do MatchDeal (matchdeal_eligible_deck,
// migração 0172), que tem de espelhar EXACTAMENTE esta normalização em SQL.
// Se mexeres numa, mexe na outra — há testes dos dois lados sobre os mesmos
// casos reais.
//
// ---------------------------------------------------------------------------
// Normalização (um termo pode vir de três sítios com formatos diferentes):
//   1. minúsculas;
//   2. separar em , ; / & + | e newline — a taxonomia usa-os a sério:
//      "AgriTech & FoodTech" -> [agritech, foodtech]
//      "Longevity, AgeTech & Wellness" -> [longevity, agetech, wellness]
//      "Adult content / pornography" -> [adult content, pornography]
//   3. remover tudo o que não seja [a-z0-9 ] e colapsar espaços.
// NÃO se separa por espaços: "digital health" tem de continuar um termo só,
// senão "health" sozinho passava a bater com tudo o que tenha "health".
//
// Comparação entre um termo da startup (s) e um da exclusão (e) — duas
// regras, ambas necessárias por causa dos dados reais em produção:
//   A. contenção por palavras inteiras, nos dois sentidos:
//      e="health" vs s="digital health" -> exclui (o investidor que exclui
//      "health" não quer ver Digital Health nem Mental Health);
//      e="foodtech; agritech" já vem separado pela regra 2, mas texto livre
//      corrido ("no foodtech please") continua a apanhar s="foodtech" pelo
//      sentido inverso.
//      Palavras INTEIRAS, com espaços à volta, de propósito: "tech" não pode
//      excluir "agritech", nem "ai" excluir "retail".
//   B. igualdade da forma sem espaços:
//      e="food tech" vs s="foodtech" -> exclui. É o caso real do perfil
//      637f8c2a em produção, que a regra A sozinha falha (nenhum contém o
//      outro como palavras inteiras). Igualdade, nunca substring, senão
//      "ai" voltava a excluir "retail" pela porta das traseiras.
// ---------------------------------------------------------------------------

const SPLIT = /[,;/&+|\n\r]+/;

function normalizeTerm(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Uma lista de strings cruas (array de sectores e/ou texto livre) -> termos
// normalizados, sem vazios e sem repetidos.
export function normalizeSectorTerms(inputs: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const raw of inputs) {
    if (!raw) continue;
    for (const piece of raw.split(SPLIT)) {
      const term = normalizeTerm(piece);
      if (term) out.add(term);
    }
  }
  return [...out];
}

export function exclusionTerms(exclusionsSectors: string[] | null | undefined, exclusionsNotes: string | null | undefined): string[] {
  return normalizeSectorTerms([...(exclusionsSectors ?? []), exclusionsNotes]);
}

function containsAsWords(haystack: string, needle: string): boolean {
  return ` ${haystack} `.includes(` ${needle} `);
}

function squash(term: string): string {
  return term.replace(/ /g, '');
}

// Um único par (termo da startup, termo da exclusão). Exportado para os
// testes poderem cobrir a regra em si, não só o resultado final.
export function termsCollide(startupTerm: string, exclusionTerm: string): boolean {
  if (!startupTerm || !exclusionTerm) return false;
  if (containsAsWords(startupTerm, exclusionTerm)) return true;   // regra A
  if (containsAsWords(exclusionTerm, startupTerm)) return true;   // regra A, sentido inverso
  return squash(startupTerm) === squash(exclusionTerm);           // regra B
}

export function isSectorExcluded(
  startupSectors: string[] | null | undefined,
  exclusionsSectors: string[] | null | undefined,
  exclusionsNotes: string | null | undefined,
): boolean {
  const exclusions = exclusionTerms(exclusionsSectors, exclusionsNotes);
  if (exclusions.length === 0) return false;
  const sectors = normalizeSectorTerms(startupSectors ?? []);
  if (sectors.length === 0) return false; // sem sectores declarados não há o que excluir
  return sectors.some((s) => exclusions.some((e) => termsCollide(s, e)));
}
