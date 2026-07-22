# connectB/IRM — Design ideas (recuperado do "ideias design.txt" via Project docs, 22 Jul 2026)

Fonte: destilação dos docs de design das sessões anteriores (connectB_ui_prompt.md +
ablute_crm_frontend_prompts.md §11 "Refinamento global"). Aplicar a TODAS as páginas,
incluindo as novas (import, privacy-request, back-office do Bloco 3).

## Personalidade de design
- Moderno, simples, minimalista — mas com PROFUNDIDADE: elevação subtil, camadas,
  micro-interações. Nunca flat-aborrecido nem decorado. Sem ilustrações, mascotes ou
  gradientes de marketing.
- Profissional-calmo: é uma ferramenta usada sob stress de fundraising — a UI deve
  baixar a ansiedade. Whitespace generoso, neutros calmos, cor contida.
- Cor = significado, nunca decoração. Verde só para verified/ok; âmbar só para
  caution/unverified; vermelho só para bloqueios e avisos duros.
- Tema claro. UI em inglês. Desktop-first, usável em telemóvel.
- Empty states desenhados: cada lista/fila vazia tem uma próxima ação clara.

## Hierarquia de ênfase (por ordem)
1. AVISOS BLOQUEANTES — o elemento mais forte da app ("hard filter open",
   "do not contact", "daily cap reached", "kill word in draft"). Impossíveis de
   ignorar, mas não histéricos.
2. A ÚNICA ação primária de cada ecrã — exatamente um botão proeminente por página.
3. Sinais de estado & verificação — pequenos, escaneáveis, consistentes em todo o lado.
4. Feedback de progresso — round progress, caps 5/dia · 20/semana sempre visíveis.
5. Tudo o resto recua.

## DESIGN REFRESH — regras concretas
- Cards: rounded-2xl, border gray-100, shadow-sm suave, 20px padding.
- Botões: rounded-xl; primário sólido #0E7490, texto semibold, sombra suave;
  hover escurece subtilmente; disabled = bg gray-100 + texto gray-400.
- Pills: rounded-full, fundo tingido ~8% da cor, texto 10-11px semibold. Sem
  bordas duras.
- Sidebar: branca, 240px; labels de secção em uppercase gray-300 (WORKSPACE,
  SHARING, GROWTH, AUTOMATION, PLATFORM); item ativo = pill sólida brand-blue com
  texto branco; bloco de marca no topo (wordmark + "INVESTOR RELATIONS" em caps
  espaçadas gray-300); rodapé "Seed Round 2026 · €1.3M".
- Top bar: branca com leve blur/transparência, borda gray-100 fina; contador de caps
  em chip rounded-full outlined; motto em gray-300 ("Outreach discipline, enforced").
- Fundo: #F7F9FA (cinza frio muito claro); conteúdo max-width 1152px; padding generoso.
- Tipografia: Inter; base 13.5-14px; headings semibold (nunca >700); números de
  dashboard podem ser 24px bold brand-blue.
- Cores: brand blue #0E7490 (primário/ativo) · light blue #E8F4F8 (fills subtis) ·
  texto #1A1A1A em branco, secundário slate #64748B · verde #2E7D32 · âmbar #B45309 ·
  vermelho #B00000 · cinza neutro #94A3B8. Nunca áreas saturadas grandes.
- Sem gradientes, sem ilustrações, sem dark theme. Arejado, calmo, tipo Linear/Notion.

## Componentes partilhados (linguagem visual idêntica em todo o lado)
1. STATUS PILL de entidade: not_contacted cinza outline · contacted azul outline ·
   in_conversation light-blue sólida · diligence azul sólida · passed vermelho outline ·
   invested verde sólida · dormant cinza sólida.
2. VERIFICATION BADGE (ponto + label): verde "Verified" · âmbar "Guessed — NOT
   VERIFIED, do not send" (valor esbatido, não selecionável, sem botão copiar) ·
   vermelho "Bounced ×N".
3. PRE-FLIGHT CHECKLIST ("Can I contact?"): 6-8 checks, verde/vermelho + razão curta;
   tudo verde → botão sólido "Log outbound"; algum vermelho → "Override…" âmbar com
   modal de justificação obrigatória (registada); do-not-contact mostra cadeado SEM
   opção de override.

## Nota para o Bloco 3 (back-office)
O back-office segue as mesmas regras MAS com header visualmente distinto (marca
"PLATFORM") para o dual-role nunca confundir as vistas — ver §6 do IRM_SPEC.
