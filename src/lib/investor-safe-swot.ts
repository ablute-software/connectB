// Prompt 211 §B — o travão da regra raiz do CLAUDE.md ("Startup-performance
// privacy"), em código e não só em teste.
//
// O que fugiu, em produção, para investidores: "High pass rate: 42 total
// passes… suggests pitch or readiness issues" e "only 116 of 759 investors
// contacted (15%)". O CRM privado do founder servido às pessoas de quem ele
// fala. A causa não foi o render — foi o prompt: /api/review/investability
// recebia `pipeline` e injectava-o no modelo, e o próprio comentário de
// cabeçalho pedia aquela frase como exemplo de bom output.
//
// A correcção estrutural é gerar DOIS artefactos (um por audiência) em vez
// de filtrar um no fim. Isto aqui é a rede por baixo: o prompt do
// investor_safe já não recebe nada do pipeline, mas um modelo pode sempre
// inferir de outra frase, e a assimetria de custos é brutal — um bullet a
// menos é um inconveniente, um bullet a mais é uma traição à startup.
//
// Deliberadamente grosseiro: prefere apagar um bullet inocente a deixar
// passar um culpado.

// Termos que só fazem sentido a falar do funil de fundraising. Sozinhos são
// inofensivos ("the team passed the milestone"); o que os torna suspeitos é
// aparecerem com NÚMEROS, que é o que os torna deriváveis.
const PRIVATE_TERMS = [
  'pass', 'passes', 'passed', 'declin', 'reject',
  'contacted', 'outreach', 'investors reached', 'response rate',
  'soft-circl', 'soft circl', 'committed', 'funding gap', 'of round', 'of the round',
  'pipeline', 'investor engagement', 'conversion',
];

const HAS_NUMBER = /\d/;

// Uma frase é suspeita quando junta um termo do funil a um número. É a
// combinação que revela: "42 passes", "116 of 759 contacted", "33% of round".
export function violatesInvestorSafety(text: string): string | null {
  const lower = text.toLowerCase();
  if (!HAS_NUMBER.test(lower)) return null;
  return PRIVATE_TERMS.find((t) => lower.includes(t)) ?? null;
}

export interface SwotBullets {
  strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[];
}

export interface SanitizeResult { data: SwotBullets; dropped: { bullet: string; term: string }[] }

// Devolve o SWOT sem os bullets que violam, e a lista do que caiu — para o
// log do servidor. O que caiu NUNCA vai na resposta HTTP: seria reintroduzir
// a fuga pela porta do diagnóstico.
export function sanitizeInvestorSwot(swot: Partial<SwotBullets> | null | undefined): SanitizeResult {
  const dropped: { bullet: string; term: string }[] = [];
  const clean = (list: string[] | undefined): string[] =>
    (list ?? []).filter((b) => {
      const term = violatesInvestorSafety(b);
      if (term) dropped.push({ bullet: b, term });
      return !term;
    });

  return {
    data: {
      strengths: clean(swot?.strengths), weaknesses: clean(swot?.weaknesses),
      opportunities: clean(swot?.opportunities), threats: clean(swot?.threats),
    },
    dropped,
  };
}

// A instrução dada ao modelo na segunda chamada. Exportada para o teste
// poder afirmar que as proibições estão lá — se alguém a suavizar, o teste
// cai.
export const INVESTOR_SAFE_INSTRUCTION =
  'This SWOT will be shown to INVESTORS looking at this startup. Use only the company facts given above. '
  + 'NEVER reference fundraising progress, investor outreach, pass or decline history, how many investors were '
  + 'contacted, response rates, amounts soft-circled or committed, funding gaps, or any platform activity — '
  + 'you have not been given that data and must not infer or estimate it. '
  + 'Positive qualitative statements about the company are welcome; numbers about fundraising are not. '
  + 'Weaknesses and threats must be about the business, market or product — never about the raise.';
