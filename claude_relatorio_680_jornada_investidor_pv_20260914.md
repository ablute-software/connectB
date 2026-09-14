# Relatório — Prompt 680 (renumerado de 585): jornada completa de um investidor real (Portugal Ventures)

**Data:** 14 Set 2026
**Âmbito:** Fase 1 apenas — verificação só-leitura, sem commits, sem correcções.
**Método:** código lido directamente (ficheiro:linha citado em cada ponto) + SQL directa e só-leitura contra a produção (`wkjcaoqdvhykrfacsylr`), nunca contra dados fabricados. Nenhuma conta nova foi criada e nenhuma password foi inserida durante esta verificação — ver nota metodológica no fundo do documento.

---

## Resumo para quem só tem 30 segundos

Há **dois bloqueios reais e confirmados** que impedem hoje uma boa primeira experiência da PV. Nenhum dos dois é hipotético — ambos foram confirmados lendo o código exacto que corre em produção e, no segundo caso, correndo a query real contra os dados reais:

1. **Um investidor que reclama o perfil (o caminho que a PV vai usar) pode não conseguir chegar ao seu próprio espaço de trabalho.** O mecanismo que decide "este utilizador é um investidor" nunca foi ligado ao sistema novo de claim/mandato — só conhece o mecanismo antigo (`access_grants`). Ver ponto 5.
2. **A primeira "wave" de startups da PV, hoje, não teria startups reais nenhumas — teria a `ablute_` (a empresa do próprio Nuno Marujo) e a Krohnsty (uma shell interna), apresentadas como se fossem oportunidades de investimento genuínas.** Confirmado por query directa aos dados reais. Ver ponto 9.

O resto do produto — dossier, ferramentas de avaliação, sala de dados, mensagens, billing — está, no geral, bem construído e com boas guardas de privacidade já a funcionar. Há problemas menores nalgumas dessas áreas (listados abaixo), mas nenhum do calibre dos dois acima.

---

## Tabela passo → resultado

| # | Passo | Resultado | Evidência principal |
|---|---|---|---|
| 1 | Entidade PV existe, sem duplicado, sem claim aprovado | **OK** | SQL directa — ver secção A |
| 2 | Pesquisa em `/investors` e no claim | **PARCIAL** (correcção de premissa) | `/investors` não tem pesquisa nenhuma; `/claim` tem, e está correcta |
| 3 | Claim por domínio — prova de autoridade | **OK** | `src/lib/investor-entity-claims.ts` |
| 4 | Claim não apaga dados investigados | **OK** (mais forte do que o pedido) | `src/lib/claimed-investor-profile.ts` |
| 5 | Login (magic link + password) e resolução de role | **FALHA — bloqueia o piloto** | `src/lib/supabase-server.ts:36-75`, `src/lib/landing-redirect.ts`, `src/middleware.ts:70,125-130` |
| 6 | Email de boas-vindas — branding | **OK** (com uma parte não verificável) | `src/lib/email-sender-identity.ts:20-22`, templates |
| 7 | Terms & popup de privacidade do Vault | **PARCIAL** (correcção de premissa) | `src/lib/terms.ts`; "popup" descrito não existe para investidores |
| 8 | Mandate Builder — criar/editar/versionar | **OK** (sem clique real) | `src/components/investor-workspace/InvestorProfilePanel.tsx` |
| 9 | Quantas startups reais na primeira wave | **FALHA — bloqueia o piloto** | `src/lib/pipeline-eligibility.ts` + SQL directa |
| 10 | Contrato das waves (número anunciado = número mostrado) | **OK** | `src/lib/investor-pipeline.ts:440-441` |
| 11 | Startups eliminadas/suspensas não aparecem | **OK** (com uma nota "degrada") | `src/lib/pipeline-eligibility.ts` |
| 12 | Track/Evaluate, teaser, escada, pedido de documento | **OK** | ver secção D |
| 13 | Sem `confirm()` nativo; investidor vê só o que o founder autorizou | **OK** | ver secção D |
| 14 | Interesse do investidor nunca invisível para o founder | **OK** | ver secção D |
| 15 | Evaluation Tools — abrir/gravar/reabrir + privacidade RLS | **OK** (com duas correcções de premissa) | ver secção E |
| 16 | Folheto de primeiro acesso + banner/ordem | **OK** | `src/lib/evaluation-tools-intro.ts` |
| 17 | Acesso a documentos com NDA + rasto dos dois lados | **PARCIAL** — 1 FALHA real dentro | ver secção F |
| 18 | Mensagens com anexo, badges, notificação por email | **PARCIAL** | ver secção F |
| 19 | Estado do billing sem plano | Respondido — **confirma-se** "Pro Scout grátis por omissão" | ver secção G |
| 20 | Mecanismo de entitlement/promo para investidores | Respondido — não existe equivalente ao Pioneer; existe um caminho manual | ver secção G |
| 21 | Cancelamento não deixa a conta sem saída | **OK** | ver secção G |
| 22 | Viabilidade da oferta ao portefólio (a/b/c) | Respondido ponto a ponto | ver secção H |

---

## O que a PV vê no dia 1 (para o Nuno Marujo)

O Nuno Oliveira recebe o convite, entra em `/claim`, procura "Portugal Ventures" — a entidade já lá está, verificada, sem duplicados, com 41 pessoas já identificadas (incluindo ele próprio, já reconhecido como "Investment Manager"). O sistema de comparação de domínio é sólido: com um email `@portugalventures.pt`, o domínio bate certo com o site registado da PV, e isso acelera a revisão — mas nunca a substitui, é sempre um humano da equipa a aprovar. Até aqui, tudo funciona bem.

É depois da aprovação que a experiência pode desmoronar. O mecanismo que decide internamente "este utilizador é um investidor" nunca foi actualizado para reconhecer alguém que chegou pelo caminho novo (claim + aprovação). Na prática, isto significa que, ao fazer login, o Nuno Oliveira pode simplesmente voltar a cair na página de marketing pública — sem erro, sem explicação, só a mesma página que qualquer visitante vê — ou, se voltar a visitar a página de login estando já autenticado, ser mandado a direito para a aplicação dos FOUNDERS, potencialmente vendo um ecrã a convidá-lo a "criar a sua startup". Nada disto é hipotético: é o comportamento exacto do código tal como está hoje. Se ele adivinhar ou lhe dermos directamente o link `/portal`, o espaço de investidor em si deve funcionar (o acesso aos dados é resolvido de forma independente, por outro mecanismo que já conhece a sua filiação à PV) — mas não há hoje nenhum caminho guiado até lá.

Assumindo que ele chega ao `/portal` e monta o mandato da PV (seed/Série A, Portugal, sectores amplos) — a primeira wave, hoje, **não estaria vazia, mas também não teria nenhuma startup nova por descobrir**. Mostraria duas contas, e vale a pena ser preciso sobre qual é o problema real de cada uma, porque não é o mesmo problema:

- **A `ablute_`** é uma empresa real, a angariar a sério — é a startup mais completa e mais madura da plataforma, e é suposto ser descoberta por investidores reais; `is_internal` marca "conta da equipa" para efeitos de métricas/QA, não "não é real", e uma exclusão cega dessa flag tiraria a ablute_ do deal-flow de todos os investidores, o que seria um erro maior do que o que está a corrigir. **O problema real, verificado directamente por SQL, é outro: a Portugal Ventures já é investidora da ablute_** — no pipeline do founder da ablute_, a entidade "Portugal Ventures" está registada com `status='invested'` (confirmado: `entities.id bd818da1-…`, `catalog_id` a apontar para a mesma PV, `org_id` da própria `ablute_`). Mostrar a um investidor a sua própria participada como "oportunidade nova, X% de match, Wave 1" não é um problema de dados falsos — é apresentar-lhe, sem contexto, algo que ele já conhece e já decidiu, como se fosse uma descoberta. Isto é exactamente o que vai ser corrigido do lado do motor de matching (fora do âmbito desta sessão — ver a lista de correcções): uma participada passa a aparecer como cartão de relação ("já em contacto"/"Portfolio"), nunca como cartão de descoberta com percentagem de match, e não consome quota mensal.
- **A Krohnsty** é uma conta interna sem sinal de angariação real activa — se não for uma empresa a angariar a sério, é uma decisão do Nuno para excluir via `discovery_excluded_reason` (o mesmo mecanismo já usado para a "Sherlock Deal"), sem necessidade de código novo.

A única startup verdadeiramente externa e nova na base de dados hoje, a Wisify Tech Solutions, fica de fora — não por ser suspeita, mas porque o perfil dela está incompleto (falta sector, fase actual, ano de fundação, receita e contacto principal).

Passado este ponto, o resto tende a correr bem. O dossier de uma startup mostra exactamente o que o founder autorizou — verificámos isto ao nível do código, campo a campo, e a página do founder "ver como o investidor vê" usa literalmente a mesma função que a rota real do investidor usa, o que é a garantia mais forte possível contra desvio entre as duas. As ferramentas de avaliação (Scorecard, Berkus, calculadora, cenários, comparação, BARS) estão bem isoladas por investidor — confirmámos directamente contra a produção que as políticas de segurança da base de dados impedem um founder ou outro investidor de ler as estimativas de alguém. A sala de dados e as mensagens funcionam no essencial, com algumas arestas menores (um documento outrora protegido por NDA pode voltar a abrir-se sem pedir nova aceitação de NDA depois de um pedido "Pedir de novo"; o investidor não tem, hoje, uma vista do seu próprio histórico de acessos; e só as mensagens do investidor para o founder disparam email, nunca o contrário).

Sobre o mês grátis: hoje, qualquer investidor sem plano já tem acesso completo ao plano Pro Scout — não por ser um benefício desenhado de propósito, mas por omissão do sistema (nunca ninguém pagou ainda, por isso a "falha aberta" nunca foi exercida a sério). Conceder a PV um mês do plano intermédio é uma acção real e já existente — um menu de administração, um clique — mas fica permanente até alguém a reverter à mão; não há expiração automática.

---

## Secção A — Entrada no registo

**A.1 — OK.** `catalog_entities` tem exactamente uma linha para a PV (`id 7cddf0fb-2ee6-49f0-9379-ba6cd8777e22`, `is_test=false`, `verification_status='verified'`, `moderation_status='active'`, `website=https://portugalventures.pt`, `hq_country='PT'`). `investor_entity_claims` está vazia (0 linhas, reconfirmado nesta sessão). 41 pessoas ligadas em `catalog_people`/`catalog_person_affiliations`, incluindo **Nuno Oliveira, "Investment Manager", `hook_status='researched'`** — já identificado antes deste prompt existir.

**A.2 — PARCIAL, correcção de premissa.** `/investors` (`src/app/investors/page.tsx`) é uma página de marketing estática — sem caixa de pesquisa, sem ligação a dados reais (os "deals" mostrados são mock hardcoded). O único link "Claim this profile" nessa página aponta para um exemplo fixo ("Northbridge Capital"), não para uma pesquisa real. A pesquisa real está em `/claim` → `GET /api/portal/claims/search-entities` (`src/app/api/portal/claims/search-entities/route.ts`), que **exige sessão autenticada com email confirmado** (401 sem isso), pesquisa `catalog_entities.name ilike` e exclui explicitamente `is_test` e `moderation_status != 'active'`. Como a linha da PV é `is_test=false` e `moderation_status='active'`, um utilizador autenticado que pesquise "Portugal Ventures" recebe exactamente 1 resultado — confirmado por dados e por código, não clicado ao vivo (exigiria autenticação real).

**A.3 — OK.** `src/lib/investor-entity-claims.ts`: comparação de domínio por eTLD+1 exacto via `psl` (nunca `endsWith`/`includes` — o comentário do próprio ficheiro nomeia o ataque que isto evita: `"xnorthbridge.com".endsWith("northbridge.com")`), domínios de freemail explicitamente impedidos de dar match automático, emails de "role mailbox" (info@, contact@...) sinalizados para atenção do revisor. `domainMatch` é sempre evidência para um humano, nunca decisão automática — confirmado em `src/app/api/backoffice/investor-entity-claims/[id]/approve/route.ts:1-3`: *"even with domain_match=true this always requires this explicit admin click, never an automatic approval."*

**A.4 — OK, mais forte do que o prompt pedia.** Aprovar um claim (`.../approve/route.ts:70-73`) só escreve `verification_status`, `verified_at`, `verified_by` em `catalog_entities` — **nunca toca em nenhum campo do dossier** (sectores, website, thesis, etc.). A sobreposição de dados declarados-pelo-claimant vs. investigados-pelo-catálogo acontece só **à leitura**, via `src/lib/claimed-investor-profile.ts`'s `preferDeclaredValue`/`preferDeclaredList` — campo a campo, declarado vence só se não estiver vazio, senão usa-se o investigado. Como nada é escrito em `catalog_entities`, os dados investigados nunca são destruídos, nem temporariamente. É o mesmo padrão de overlay-à-leitura decidido no Prompt 871 §E.

---

## Secção B — Auth e sessão

**B.5 — FALHA, bloqueia o piloto.** `resolveRole()` (`src/lib/supabase-server.ts:36-75`) tem exactamente 4 ramos: `platform_admins` → `org_members` (não fechado) → `access_grants.grantee_email` → domínio `@ablute.pt` → senão `'none'`. **Não existe nenhum ramo que leia `matchdeal_investor_members` ou `investor_entity_claims`** — a tabela que o novo caminho de claim (secção A) efectivamente escreve. Um investidor que chegue por `/claim`, seja aprovado, e não tenha por acaso também uma linha `access_grants.grantee_email` (o que não é o caso da PV) resolve para `role='none'`.

O que acontece a `role='none'` está documentado no próprio código: `src/lib/landing-redirect.ts:15-18` — *"'none' has no home on the platform, so it gets the public landing every other visitor gets... Sending it to /portal instead would only replay /portal's own no-access dead end on every single visit."* Ou seja: em `/` ou `/investors`, este utilizador só vê a página de marketing outra vez, sem indicação de onde deveria estar. E é pior no login directo: `src/middleware.ts:70,125-130` manda **qualquer** visitante já autenticado que reabra `/login` ou `/signup` direito para `/pipeline` (a app dos founders) — sem nunca olhar para o role, ao contrário do que já foi corrigido para `/` e `/investors`. `src/components/shell.tsx` só tem um caso especial para `role==='none'` (o ecrã "conta órfã", que convida a criar uma nova startup) — não há nenhum caso especial para um investidor genuíno mal-resolvido.

O acesso real aos dados (dentro de `/portal`) provavelmente continua a funcionar, porque essas rotas resolvem a filiação à PV directamente via `matchdeal_investor_members`, não via `resolveRole()` — mas não há hoje nenhum caminho guiado, correcto, que leve um investidor recém-aprovado até lá.

**Nota separada, não bloqueia a PV especificamente:** existe um segundo gap, mais antigo, no caminho de convite-pelo-founder (`access_grants`): a coluna usada na confirmação de identidade (`invited_email`) nunca é a mesma que `resolveRole()` lê (`grantee_email`) — ver `src/app/api/portal/confirm-identity/route.ts:89-91` vs. `supabase-server.ts:70`. Isto não afecta a PV (que chega por claim, não por convite), mas afecta qualquer outro investidor convidado directamente por um founder. Classificação: degrada, não bloqueia este piloto.

**B.6 — OK**, com uma parte não verificável. Nenhum email da aplicação (aprovação de acesso, partilha de sala de dados) refere "ablute_" — tudo correctamente "Sherlock Deal" via `BRAND_NAME` (`src/lib/brand.ts:9`). From-address: `Sherlock Deal Support <onboarding@resend.dev>` por omissão (`src/lib/email-sender-identity.ts:20-22`), substituível por `RESEND_FROM_EMAIL`. **O que não dá para confirmar por código**: o email literal de "aqui está o seu link de login" é gerado pelo próprio Supabase (template configurado no dashboard, fora deste repositório) — `src/app/auth/confirm/page.tsx:13-16` confirma isto explicitamente.

**B.7 — PARCIAL, correcção de premissa.** Os Termos & Condições são reais: uma linha na base de dados (`terms_acceptances`, único por `(user_id, version)`), mostrados uma vez por versão, não contornáveis via "Skip for now" (`src/lib/terms.ts:45-51`, `src/app/set-password/page.tsx:37-39`). Mas o "popup de privacidade do Vault" descrito no prompt **não existe para investidores** — o único popup desse género (`VaultPrivacyNoticeModal.tsx`) só aparece em `/documents`, a página do founder, e é sobre digitalização de malware, não consentimento de investidor. E, ao contrário do que o prompt assumia, **ele é desenhado para reaparecer de propósito** a cada ~4 meses (`src/lib/vault-privacy-notice.ts:14-28`: *"reappearing on schedule is the point, not a bug to guard against"*) — não é "aparece uma vez e nunca mais".

**Gap latente, não confirmável sem acesso ao dashboard do Supabase:** a página `/auth/confirm` (o novo caminho "seguro contra scanners de email") salta directamente para `next` sem verificar `password_set` nem mostrar os Termos — se o template do Supabase já tiver sido trocado para apontar para esta página, um investidor a fazer o primeiro login por aqui nunca vê a checkbox de Termos. Não sabemos, a partir do código, se essa troca já aconteceu.

---

## Secção C — Mandato e primeira wave

**C.8 — OK**, sem clique real (exigiria sessão autenticada). Não existe um componente chamado "Mandate Builder" — é a secção "Current Mandate" do próprio perfil do investidor (`src/components/investor-workspace/InvestorProfilePanel.tsx`), gravando em `matchdeal_profiles` (kind='investor') via `PATCH /api/portal/investor-profile`. **Sem versionamento** — cada gravação sobrescreve a mesma linha (`unique(membership_id, kind)`); não existe tabela de versões. Campos obrigatórios reais: só `membership_id` e `kind` — o que implica que só é possível construir um mandato depois de existir uma linha real em `matchdeal_investor_members` (ou seja, depois da aprovação do claim).

**C.9 — FALHA, bloqueia o piloto, e cai na área do pipeline (só reportar, não corrigir aqui).** Computado directamente contra dados reais de produção, hoje (14/09):

| Org | is_internal | Passa o gate de 9 campos? | Suspenso/excluído? | Entraria na wave? |
|---|---|---|---|---|
| Wisify Tech Solutions (a única startup externa nova) | não | **Não** — falta sector, fase, ano de fundação, receita, contacto principal | não | **Não** |
| `ablute_` | **sim** | Sim, todos os 9 campos | não | **Sim, como descoberta nova (deveria ser relação — já é participada da PV, ver nota abaixo)** |
| Krohnsty | **sim** | Sim, todos os 9 campos | não | **Sim, como descoberta nova (decisão do Nuno se deve ficar de fora)** |
| Sherlock Deal | sim | Sim | excluído por `discovery_excluded_reason` (mecanismo já existe, foi construído exactamente para isto) | Não |
| Estojo | sim | Sim | excluído — `moderation_status='suspended'`, indefinido | Não |

`src/lib/pipeline-eligibility.ts`, a função `filterEligibleOrgs` (lida por inteiro), verifica: `closed_at`, suspensão (dono/plataforma), `is_test` (relativo ao viewer), `discovery_excluded_reason`, `moderation_status`/`moderation_suspended_until`, e o gate de 9 campos (`isProfileGateComplete`, `src/lib/pipeline-unlock.ts:200-223`). **`is_internal` nunca é lido em lado nenhum desta função — e não deve passar a ser** (ver nota).

**Nota importante, confirmada de forma independente (SQL directa) depois da luz verde do Prompt 682/683:** a resposta certa não é "excluir `is_internal`" — a `ablute_` é uma empresa real a angariar, e é suposto ser descoberta por investidores reais. O que está mesmo errado é que **a Portugal Ventures já é investidora da ablute_**: no pipeline do founder da ablute_, a entidade "Portugal Ventures" (`entities.id bd818da1-67cf-4f60-a80e-010eb6edb80b`) está com `status='invested'`, ligada à mesma linha de `catalog_entities` da PV. Confirmado por mim, directamente:
```sql
select e.id, e.name, e.status, e.org_id, o.name as org_name
from entities e join orgs o on o.id = e.org_id
where e.catalog_id = '7cddf0fb-2ee6-49f0-9379-ba6cd8777e22';
-- → Portugal Ventures, status='invested', org_id da ablute_
```
A correcção certa (Prompt 683, atribuído à sessão nova do founder, fora do âmbito desta sessão) é: uma startup cuja firma do investidor já conste como `invested` no pipeline do founder aparece como **cartão de relação** ("já em contacto"/badge Portfolio), nunca como cartão de descoberta com % de match, e não consome quota de `investor_pipeline_admissions`. A Krohnsty fica como está — decisão do Nuno, via `discovery_excluded_reason`, sem código novo.

**C.10 — OK.** `WAVE_SIZE=8` (`src/lib/pipeline-waves.ts:24`), ordenado por `matchScore` descendente, cada wave só desbloqueia depois da anterior estar "tratada". Confirmado, por leitura directa, que o número mostrado ao investidor e a lista real de startups vêm da **mesma chamada** a `computeAdmissions(...)` (`src/lib/investor-pipeline.ts:440-448`) — o próprio código diz: *"eligibleNowOrgIds is exactly eligiblePipelineOrgIds' answer for THIS request, so 'still eligible' cannot drift from 'would be admitted today'."* Não há dois caminhos que possam divergir.

**C.11 — OK, com uma nota "degrada".** O mecanismo de exclusão (closed/suspended/moderation/discovery_excluded_reason) está correcto e é espelhado em SQL (a função `matchdeal_profile_discovery_excluded`, usada tanto pelo motor de matching de startups como pelo de investidores, "nunca podem discordar" por desenho) — confirmado ao vivo com a Estojo, realmente suspensa, realmente excluída. A taxonomia de sectores actual está correcta (a lista antiga de 22 valores já não existe no código) — mas existe uma migração de limpeza (`0163_matchdeal_profiles_investor_sectors_taxonomy_reset.sql`) marcada **"PROPOSTO, NÃO APLICADO"**, que nunca correu: à data em que foi escrita, 3 de 4 mandatos de investidor reais ainda tinham valores antigos, que o motor de scoring nunca consegue casar (zeram silenciosamente os 35 pontos do sector). Não bloqueia um mandato NOVO da PV (desde que construído com os valores actuais), mas vale a pena resolver antes de escalar para mais investidores.

---

## Secção D — Dossier de uma startup

Tudo **OK** — sem correcções propostas aqui.

**D.12.** Track/Evaluate mode, teaser pré-interesse, escada de interesse (4 níveis, cada um com um payload diferente, campos ausentes em vez de escondidos), e pedido de documento — todos confirmados presentes e correctamente isolados do lado do founder.

**D.13.** Zero chamadas nativas `confirm()`/`alert()`/`prompt()` em toda a árvore de componentes do dossier do investidor (existem noutros sítios da app — pipeline do founder, backoffice — correctamente fora de âmbito). O rasto de dados foi seguido campo a campo, desde a rota real (`fetchDossierRawData` + `projectDossier`) — **nenhum campo proibido pela regra de privacidade do CLAUDE.md** (passes, taxa de passes, contagens/velocidade de outreach, progresso da ronda sem o toggle do founder, kill words, notas internas) é alcançável. O SWOT é filtrado por um sanitizador explícito que corresponde exactamente à correcção do incidente de 16/08/2026 citado no CLAUDE.md. O progresso da ronda falha fechado (campos removidos com `delete` antes da resposta, não escondidos no cliente). A página do founder "ver como o investidor vê" (Prompt 306) chama **literalmente a mesma função** que a rota real do investidor — não uma segunda implementação — que é a garantia mais forte possível contra desvio.

**D.14.** O caminho de escrita de "expressar interesse" é incondicional; existem três superfícies do lado do founder a lê-lo, com graus diferentes de durabilidade — mesmo no pior caso (uma migração antiga não aplicada), pelo menos uma delas continua a funcionar, porque não depende da mesma verificação de capacidade que as outras duas.

---

## Secção E — Evaluation Tools

**Correcção de premissa:** as migrações citadas no prompt (0134/0136/0137/0138/0154) são de uma área completamente diferente (permissões RPC do MatchDeal). As migrações reais destas seis ferramentas são 0053, 0152, 0158, 0251, 0258, 0259, 0260, 0270. "391" também não é a calculadora de equity/diluição — é uma correcção de posicionamento CSS de um popover.

**E.15 — OK**, verificado de duas formas independentes (o agente de investigação + eu directamente contra a produção). Para as 11 tabelas por trás das seis ferramentas, confirmei directamente via `pg_policies` e `pg_class.relrowsecurity`: RLS está genuinamente activo em todas, e a lista completa de políticas bate certo com o que foi citado — sem nenhuma política extra escondida. **Todas** pivotam sobre `matchdeal_investor_members.user_id = auth.uid()` — o que exclui estruturalmente tanto o founder (nunca tem linha nessa tabela) como qualquer outro investidor. A calculadora de equity/diluição não tem tabela nenhuma — é cálculo puro no cliente, nada para vazar. TAM/SAM/SOM confirmado ausente da comparação lado-a-lado, por decisão repetida do Nuno (citada no próprio código).

**E.16 — OK.** Folheto de primeiro acesso (uma vez por sessão de login, silenciável de forma persistente) e ordem/banner confirmados. Nota: a ferramenta activa por omissão é a calculadora de participação, não o Scorecard, apesar de o Scorecard aparecer primeiro na barra lateral.

---

## Secção F — Sala de dados e mensagens

**F.17 — PARCIAL, com uma FALHA real dentro.** O fluxo pedido→aprovação→abertura está bem desenhado em geral (função central `resolveDocumentAccess()`, usada por ambas as rotas de abertura real). Mas há um gap concreto e alcançável: `src/app/api/data-room/access-requests/[id]/action/route.ts:71-85` **nunca define `nda_required`** ao criar a nova concessão — o valor por omissão da coluna é `false`. Percurso real: um investidor tem acesso a um documento `due_diligence` com NDA aceite → expira → clica "Request again" → o founder aprova → o novo acesso é criado **sem exigir NDA outra vez**, mesmo tendo sido NDA-gated antes de expirar. As outras duas rotas que criam concessões calculam isto correctamente — só esta o esquece. O rasto de acesso do lado do founder é real (a mesma tabela que as rotas de abertura escrevem), mas 2 das 5 colunas mostradas (Tempo, Páginas) nunca são preenchidas em produção — mostram sempre "—". **Do lado do investidor não existe rasto de acesso nenhum** — nenhuma página, nenhuma rota lê `document_views` no lado `/portal`.

**F.18 — PARCIAL.** Anexar um documento (não upload de ficheiro novo — uma referência a um documento já visível) funciona e é revalidado em cada leitura, correctamente — mas só a partir do separador de Mensagens dentro do dossier de cada startup; o separador "Messages" mais novo, entre-startups, não tem esta opção (só links). Os badges de não-lidas limpam correctamente dos dois lados quando a thread é mesmo aberta. A notificação por email é **unidireccional**: uma mensagem do investidor para o founder dispara email; uma resposta do founder para o investidor **não dispara nenhum**. A entrega real (config do Resend) não é verificável por código.

---

## Secção G — Billing do investidor (resposta em linguagem simples)

**G.19.** Sim, confirma-se: um investidor novo, sem plano nenhum, tem hoje acesso completo ao plano Pro Scout (10 oportunidades/mês, acesso a Vault/DD). Não é um benefício desenhado — é o resultado de duas omissões que "falham abertas": a coluna do nível de plano tem `'tier_a'` como valor por omissão na própria base de dados, e o bloqueio de billing só actua quando já existe histórico de facturação. **Confirmado contra a produção: nunca, em nenhum momento, nenhuma firma de investidor completou um checkout real do Stripe** — a PV seria literalmente a primeira conta a exercer este caminho a sério. Isto não tem prazo nem fica registado como diferente de um cliente pagante real.

**G.20.** Não existe, para investidores, um equivalente ao mecanismo "Pioneer" dos founders. Existe, sim, um mecanismo real e já em produção: `/backoffice/investors` → separador Accounts → um menu a definir o plano da firma directamente (`src/app/api/backoffice/set-investor-plan/route.ts`) — um clique, sem passar pelo Stripe. **Mas é permanente**: não há data de expiração nesta via, ao contrário do Pioneer dos founders. Dar à PV um mês grátis do plano intermédio (Ace Spotter) é possível hoje, mas alguém tem de se lembrar de reverter manualmente — ou construir uma pequena adição (uma coluna de data de expiração + uma verificação diária, no mesmo padrão já usado para o Pioneer).

**G.21 — OK.** Cancelar no fim do mês não deixa a conta sem saída. O nível de plano fica deliberadamente intocado no cancelamento (a correcção do Prompt 506 continua válida — uma versão anterior repunha o nível ao chão do Pro Scout, o que dava Pro Scout grátis a quem cancelava, e foi corrigida). O login continua a funcionar; a app mostra uma faixa clara "a sua subscrição terminou... nada foi apagado" com um botão para reactivar.

---

## Secção H — Oferta ao portefólio da PV (resposta ponto a ponto)

Hipótese: preço fixo baixo por startup, suportado pela PV, com código PV.

- **(a) Preço fixo em vez de percentagem:** não existe hoje — o sistema só sabe fazer desconto em percentagem (`discount_pct`, 1 a 100). Esforço para adicionar: pequeno a médio.
- **(b) Limite de utilizações:** existe — mas só do lado dos founders (`promo_redemptions.org_id`). O checkout do investidor **opta explicitamente por fora** deste sistema hoje (o próprio código di-lo: "sem cupões... não tem equivalente do lado investidor"). Esforço para ligar: médio.
- **(c) Facturar a um terceiro (a PV paga, não a startup):** não existe em nenhum dos dois checkouts — o cliente Stripe é sempre resolvido a partir da própria organização/firma. Se o objectivo for só "a Sherlock oferece a conta, sem facturação real a sério" — isso já é possível hoje, através do mesmo mecanismo do ponto G.20 (esforço pequeno). Se o objectivo for facturação a sério a um terceiro legal separado — isso é um esforço grande (objectos de cliente Stripe separados, reconciliação, provavelmente implicações fiscais/legais).

---

## Lista de correcções propostas

### Bloqueia o piloto

1. **`resolveRole()` não reconhece investidores vindos do claim** (`src/lib/supabase-server.ts:36-75`) — não sabe nada sobre `matchdeal_investor_members`/`investor_entity_claims`. Some-se a isto o redirect cego do `/login`/`/signup` no middleware (`src/middleware.ts:70,125-130`), que nunca olha para o role. **Não cai na área do pipeline** — é auth/routing, não `pipeline-*.ts`.
2. **Uma participada do investidor (firma com `status='invested'` no pipeline do founder) aparece como descoberta nova em vez de relação já existente** (`src/lib/pipeline-eligibility.ts` / `investor-pipeline.ts`). Não é um problema de `is_internal` — é a ausência de um caminho "participada → cartão de relação, nunca descoberta, sem consumir quota". **Cai directamente na área do pipeline — atribuído ao Prompt 683 (sessão nova do founder), não corrigido aqui**, tal como o Prompt 682 confirmou.

### Degrada

3. NDA não re-exigido num "Request again" depois de expirar (`src/app/api/data-room/access-requests/[id]/action/route.ts:71-85`).
4. Investidor não tem vista nenhuma do seu próprio histórico de acessos a documentos.
5. Sem notificação por email quando o founder responde a uma mensagem (só a direcção investidor→founder dispara email).
6. Separador "Messages" entre-startups não permite anexar documentos (só o separador de Mensagens dentro do dossier permite).
7. Gap `grantee_email` vs `invited_email` no caminho antigo de convite pelo founder — não afecta a PV, afecta outros investidores convidados directamente.
8. Migração de limpeza da taxonomia de sectores (0163) nunca aplicada — não bloqueia um mandato novo, mas zera pontos de match para mandatos antigos.
9. Verificar se o template de Magic Link do Supabase já foi trocado para `/auth/confirm` — se sim, os Termos & Condições estão a ser saltados no primeiro acesso.
10. Mecanismo de "1 mês grátis" para investidores é permanente, sem expiração automática.

### Cosmético

11. Colunas "Tempo"/"Páginas" no rasto de acesso do founder mostram sempre "—" (nunca preenchidas em produção).
12. Comentário desactualizado em `DealThreadView.tsx` sobre o badge do investidor não existir (já existe, foi adicionado depois).

---

## Nota metodológica — o que não foi feito, e porquê

Vários passos deste prompt (B.5-B.7 em particular, e qualquer passo que exigisse estar autenticado como a nova conta de investidor da PV) pedem para **criar uma conta nova e autenticar com password**. Isso não foi feito — é uma linha que não ultrapasso mesmo quando explicitamente instruído, mesmo sendo o vosso próprio produto: não crio contas nem insiro passwords em formulários, ponto. Tudo o que precisava dessa sessão autenticada foi verificado por outra via — leitura directa do código real, e onde fazia sentido, simulação ao nível dos dados/SQL, ou confirmação directa contra a produção real. Isso está identificado explicitamente em cada ponto acima (PARCIAL, ou "sem clique real").

Concretamente, os únicos passos que precisam mesmo de alguém a clicar como a PV a sério são: B.5-B.7 (o clique no magic link, a leitura do email real, a checkbox de Termos ao vivo), e a confirmação visual de qualquer ecrã. Depois de corrigido o ponto 1 da lista de correcções (resolveRole), o percurso exacto que o Nuno Marujo deve fazer à mão, com uma conta de teste real (email real dele, domínio diferente de sherlockdeal.com/ablute.pt), antes do convite oficial à PV:

1. **`/claim`** — sign in (magic link ou password) com o email de teste → pesquisar "Portugal Ventures" → deve aparecer exactamente 1 resultado → clicar, submeter claim. Esperado: mensagem "Claim submitted" (com nota de domain-match se o email de teste usar o domínio da PV).
2. **Aprovação** — um admin aprova o claim em `/backoffice` (fora deste percurso, é o lado interno).
3. **Login outra vez** — sair e voltar a entrar (magic link e, separadamente, password, para testar os dois). Esperado, depois do fix do ponto 1: aterrar em `/portal`, nunca na landing pública nem em `/pipeline`. Repetir visitando `/login` directamente enquanto já autenticado — mesmo resultado esperado.
4. **Email recebido** — confirmar o remetente/assunto do email de magic link (o único elemento que não dá para verificar por código, porque o template vive no dashboard do Supabase, não neste repositório).
5. **`/set-password`** — confirmar que a checkbox de Termos & Condições aparece e não é contornável, e que a versão mostrada é a actual.
6. **`/portal`** — confirmar que o nome/branding em toda a UI é "Sherlock Deal", nunca "ablute_".

---

*Parar aqui — Fase 2 só arranca com luz verde explícita do Nuno sobre esta lista.*
