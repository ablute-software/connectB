# site-copy-920.md — Prompt 920 · copy final para aprovação (16/10/2026)

**Estado: nada foi implementado nem publicado.** Este ficheiro é o que o prompt pede primeiro: o texto final de cada página, para o Nuno rever. A implementação só começa depois de ele dizer "sim" (e cada toque na home do §F tem o seu "sim" à parte).
Branch `feat/920-public-site` (a partir de `origin/main` `6b38e01a`, sem upstream), no worktree `.claude/worktrees/920-site`.

---

## 0. Ler primeiro (em português)

### 0.1 Três achados que o prompt não previa

1. **O `robots.txt` e o `sitemap.xml` não são servidos hoje.** Em produção, `https://www.sherlockdeal.com/robots.txt` e `/sitemap.xml` respondem **307 → `/login?next=…`** (medido a 16/10/2026): o `middleware.ts` só deixa passar a lista `PUBLIC`, e estes dois ficheiros não estão lá (o `matcher` só exclui imagens, fontes e vídeo). Consequências:
   - Qualquer `robots.ts` ou `sitemap.ts` novo seria **invisível** para os motores — é preciso abrir esses dois caminhos no middleware, e abrir também `/for-startups`, `/about`, `/faq` (hoje dão 307 para o login) e acrescentá-los à lista de rotas "nuas" do `shell.tsx` (senão um visitante veria as páginas dentro do chrome da app de founder).
   - **O bloqueio de IA do Prompt 514 nunca esteve em vigor**: o `src/app/robots.ts` (514/537) manda bloquear GPTBot, ClaudeBot, PerplexityBot, Google-Extended, etc. e `/guest/` + `/api/` para todos — mas nenhum crawler consegue ler esse ficheiro. Ao corrigir o middleware, **essas regras passam a valer de um dia para o outro**, e valeriam contra o objectivo deste prompt. Daí a decisão **D1** abaixo.
2. **O teu rascunho de FAQ tem afirmações que o produto não cumpre** (verificadas no código e na base — ver §0.3). As que mudei: "cinco dimensões incluindo recent activity" (o código pontua **quatro** do lado do founder — sector, estágio, ticket, geografia — e cinco do lado do investidor, com *instrumento*; **actividade recente não entra no score**); "a Free inclui readiness tools" (o **Readiness & Train é só dos planos pagos**; o plano gratuito vê-o em pré-visualização com *frost*); "build the deck inside Readiness & Train" (idem); "investors ... most likely to say yes" (promete um resultado que o produto não mede — e os Termos 4.5 dizem que os scores são "indicative only ... create no expectation of introduction, meeting or investment"); "20–40% de resposta" (sem fonte — retirei); "não vende contactos" (o produto **entrega** canais de contacto publicados — email geral/formulário — dentro da subscrição; não afirmo o contrário); "first contact" como vantagem temporal (não há mecanismo de exclusividade nem de ordem — ver **D6**); "team seats" como diferença dos planos (o próprio `plans.ts` marca-os `NOT_ENFORCED`).
3. **O `/investors` já tem FAQ (4 perguntas) e números**: "500+ investor profiles … across 25+ European countries". Verifiquei na base (leitura): **760** perfis verificados, activos e não-teste (710 sem os organismos públicos) em **28 países**; **18** com sede em Portugal. O "500+ / 25+" é verdadeiro. Mantenho-o — ver **D5**.

### 0.2 Decisões que preciso de ti (cada uma com a minha recomendação)

| # | Decisão | Recomendação |
|---|---|---|
| **D1** | **Crawlers de IA vs. Prompt 514.** O 514 (e a cláusula 7.1 dos Termos) mandam bloquear. O 920 manda permitir. Como o robots passa a ser servido, a escolha é agora. | **Permitir nas páginas públicas** os bots que respondem a perguntas (OAI-SearchBot, ChatGPT-User, PerplexityBot, Perplexity-User, Claude-SearchBot, Claude-User, Bingbot, Applebot) **e** os quatro que nomeaste (GPTBot, ClaudeBot, Google-Extended, Applebot-Extended); manter bloqueados os restantes da lista do 514 (CCBot, Bytespider, Meta-*, Amazonbot, Cohere, Mistral, AI2Bot, Diffbot…); `/guest/`, `/api/` e toda a app autenticada ficam `Disallow` para todos. As páginas públicas são só marketing — o catálogo e o portal continuam atrás de login. Tabela completa em §7.1. **Precisa do teu "sim"**, porque reverte uma decisão deliberada tua. |
| **D2** | **Tocar no `middleware.ts` (a porta de autenticação) e no `shell.tsx`.** Acrescento a `PUBLIC`: `/robots.txt`, `/sitemap.xml`, `/for-startups`, `/about`, `/faq` (e `/compare`, `/pt` quando existirem) e à lista "nua" do shell as três páginas. Numa só lista partilhada (`src/lib/public-site-routes.ts`) para o middleware, o shell e o sitemap não poderem divergir, com teste. | **Sim.** É aditivo e exacto (sem prefixos largos). O `dev:verify` não apanha erros do middleware (modo demo salta-o): a prova é um teste unitário **e** `curl` em produção depois do deploy. |
| **D3** | **Aceitas as versões corrigidas dos factos?** (§0.1.2 e a tabela §0.3) | Sim — o texto abaixo já está escrito com elas. Cada linha da tabela tem a fonte. Inclui a frase **"Today Sherlock Deal takes no equity and no success fee"** (`/about`, Q15): a comissão está suspensa por decisão tua de 23/07/2026; se a reactivares, a frase muda. |
| **D4** | **Dados da entidade no schema `Organization` e no `/about`.** O que vem do código: operadora **Exotictarget, Lda** (NIPC 515206415; sede em Viana do Castelo — já pública nos Termos); não há email público (só `/contact`). **Não encontrei:** data de fundação, nome do fundador, perfis externos. | Incluir `legalName` e `addressLocality: Viana do Castelo` / `PT` (já são públicos e resolvem a colisão de nome); **omitir** `foundingDate`, `founder` e `sameAs` até me dares os valores / existirem as entradas (Wikidata, Crunchbase, Dealroom, LinkedIn). Diz-me se queres o teu nome como fundador. |
| **D5** | **Número do catálogo.** | Manter **"more than 500 verified investor profiles across more than 25 European countries"** (igual ao `/investors`, verdadeiro hoje: 760 / 28). Uma constante num ficheiro; sobe só quando disseres. Não escrevo "18 em Portugal" (é pouco e engana). |
| **D6** | **"First contact."** O produto entrega ao investidor ondas curadas de startups que cumprem o mandato (limite mensal por plano), com navegação privada e introdução só por opt-in mútuo; **não há** exclusividade nem prioridade temporal. | Escrevi "first contact" como **"the first conversation is with a startup that already fits"** (verdadeiro), nunca como "antes de qualquer outro". Se queres a promessa temporal, é uma feature a construir, não copy. |
| **D7** | **§F — toques na home** (cada um só com "sim" teu). | **F1** (toggle "For Startups" → `/for-startups`): sim, mas repara que quem está em `/investors` e carrega "For Startups" passa a cair no guia e não na landing de founders (o guia tem o mesmo CTA e liga à home). **F2** (rodapé): sim, **mínimo** — acrescento só "About" e "FAQ" à linha de links que já existe, sem reorganizar em colunas (as colunas Product/Company/Legal ficam para as páginas novas). **F3** (linha por baixo do H1): **recomendo sim** — hoje o H1/lead descrevem um "investor relations workspace" (um CRM) e é isso que um motor vai resumir ao ler a home; sem a linha, a meta description (invisível) e o texto visível contradizem-se. Texto em §6. |
| **D8** | **`/investors`: "rever, não recriar".** A página já tem hero, claim, método, features, pricing e FAQ. | Alterações **aditivas**: metadados + JSON-LD (invisíveis); **3 perguntas novas** no acordeão que já existe; e **uma secção nova** "How to find startups that fit your thesis" com os mesmos estilos (`s.sec`/`s.split`), entre "Access" e "Pricing". A secção é visível → só entra com o teu "sim" (sem ela, o resto funciona). Texto em §3. |
| **D9** | **Expectativas sobre schema.** Desde 2023 o Google só mostra rich results de FAQ a sites de governo/saúde e retirou os de HowTo. O markup continua a valer como estrutura legível por máquina (e valida no Schema Markup Validator), mas **não vai dar estrelinhas nem caixas de FAQ no Google**. Não há prova pública de que o schema mude o que o ChatGPT/Perplexity citam; o que mais pesa é texto claro, páginas indexadas (Bing incluído) e entidade consistente. | Fazer na mesma (custo baixo, sem risco), com a verificação em §H do prompt (Rich Results Test para `Organization`/`SoftwareApplication`/`FAQPage`; Schema Markup Validator para `HowTo`/`Article`). |
| **D10** | **Imagem Open Graph.** Não existe (`og:image` ausente; o card Twitter é `summary_large_image` sem imagem). Não foi pedida. | Fora do âmbito; proponho num adenda (uma imagem 1200×630 gerada do logótipo). |

### 0.3 Factos verificados (afirmação → fonte → estado)

| Afirmação nas páginas | Fonte | Estado |
|---|---|---|
| Planos: Free **"Elementary, my dear"** €0 (para sempre) · **"List of Suspects"** €85/mês (€756/ano) · **"It's the butler!"** €149/mês (€1 308/ano) · **"Private Detective"** sob consulta (sem preço) | `src/lib/plans.ts` `PLANS`, `PRIVATE_DETECTIVE_PLAN`; landing | ✔ — o schema `offers` leva **3** ofertas com preço (o prompt dizia "4 planos"; o 4.º não tem preço público) |
| Free: até **10** investidores curados novos/mês (25 e 50 nos pagos); MatchDeal 3 investidores/semana; 1 utilizador; data room com controlo de acesso; outreach protegido; calendário; importação em massa | `pipeline-unlock.ts` `PLAN_PIPELINE_MONTHLY_ADDITION`, `plans.ts` `buildPlanSections` | ✔ (os números saem **do mesmo ficheiro** que a landing: sem deriva) |
| **Readiness & Train** (revisão AI de documentos, investability, action plan, Train) = **planos pagos** | `plans.ts` `reviewOptimization`, `REVIEW_OPTIMIZATION_PREVIEW_COPY` | ✔ (o rascunho dizia o contrário para a Free) |
| **Rascunhos AI personalizados** = planos pagos; templates e escrita manual em todos | `plans.ts` `aiComposer`, `AI_COMPOSER_LOCKED_COPY` | ✔ |
| Matching do lado do founder: **sector, estágio, ticket, geografia** (limiar ≥ 55 para entrega) | migração `catalog_match_score` / `catalog_top_matches` | ✔ — **"recent activity" não é pontuado** |
| Matching do lado do investidor: **sector, estágio, ticket, geografia, instrumento** + exclusões como filtro duro; critérios por confirmar não contam como match | `src/lib/investor-match-score.ts` | ✔ |
| Catálogo: 760 perfis verificados/activos/não-teste, 28 países (96 sem país), 18 com sede em PT; tipos: VC, organismo público, CVC, family office, angel fund/network, aceleradora | leitura SQL a `catalog_entities`, 16/10/2026 | ✔ — copy usa só "500+ / 25+" |
| Uma startup só entra no pipeline de um investidor quando o **perfil nuclear (9 campos)** está completo; o founder pode escondê-la a qualquer momento | `pipeline-unlock.ts` `PROFILE_GATE_FIELDS`, `portal-access.ts` (850 §A/§B), `/api/company/visibility` | ✔ |
| Divulgação em degraus, NDA, dossier só do que o founder mostra; **nunca** dados de desempenho (passes, contagens de outreach, notas, estado de negociação) | `investor-interest-level.ts`; `CLAUDE.md` (regra-raiz de privacidade); Termos 4.3 | ✔ |
| Sherlock Deal **não** é investidor/corretor/crowdfunding, não detém fundos, não dá aconselhamento, não verifica nem garante informação; scores são indicativos | Termos v3 §4.4, §4.5 | ✔ (as frases do `/about` e da FAQ #15 seguem esta redacção) |
| Entidade operadora: **Exotictarget, Lda**, NIPC 515206415, sede Viana do Castelo; sem email público | `src/lib/controller.ts`, Termos | ✔ — **D4** |
| Hoje não há *success fee* (suspensa a 23/07/2026); só subscrição | `plans.ts` (comentário) | ✔ — escrevo "today" |
| Workspace de organizações do ecossistema: portfolio (convidar startups), coortes, equipa, **Calls**, perfil; o founder escolhe o que partilha (níveis 0–2 activos: Linked / Profile / Analysis); documentos e fundraising **ainda não** partilháveis | `src/components/incubator/*`, `src/lib/incubators.ts` `SHARING_LEVELS`, `CALLS_MODE` omisso = on | ✔ — **sem** "leitura agregada de preparação" (não existe no workspace) |
| Investidor: mandato versionado, ondas curadas, teto mensal por plano, navegação privada, comparação lado a lado, lista *Watching* com alertas (privada), introdução só por opt-in mútuo na MatchDeal | `src/components/investor-workspace/*`, `pipeline-quota-line.ts`, página `/investors` | ✔ |
| Limites de outreach por omissão **5/dia, 20/semana** (configuráveis por org); contact lock 14 dias; linter de mensagens | `orgs.daily_cap/weekly_cap` (migração 0001), `rules.ts` | ✔ |
| Startups de qualquer país podem registar-se (país é texto livre); catálogo europeu | `EmailCodeSignup.tsx`, `IdentityCard.tsx` | ✔ |
| Fases do round no produto: pre-seed, seed, Series A, later, other | `types.ts` `Stage` | ✔ — posicionamento "pre-seed to Series A" é teu |
| `NEXT_PUBLIC_APP_URL` está definida com `https://www.sherlockdeal.com` | `canonical`/`og:url` da home em produção | ✔ (registo `CONFIG_REGISTRY.md` actualizado neste commit) |
| `/robots.txt` e `/sitemap.xml` dão 307 → login | `curl` a produção, 16/10/2026 | ✔ — **achado 1** |

---

## 1. Home `/` — só metadados invisíveis (a landing não muda de aspecto)

- **`<title>`:** `Sherlock Deal — Find the right investors for your startup, and the right startups for your thesis` (a tua; a parte que os motores mostram é a primeira — "Sherlock Deal — Find the right investors for your startup").
- **`meta description` e `og:description`/`twitter:description`** (≤ 160 caracteres, o essencial nos primeiros 120):
  > Sherlock Deal matches startups with investors that fit — by sector, stage, ticket size and geography — and gives investors startups that fit their mandate.
  *(155 caracteres. Diferenças face ao rascunho: "that fit" em vez de "most likely to say yes" — D3; "sector, stage, ticket size and geography" em vez de "thesis, stage, ticket and recent activity" — não há score de actividade recente; sem "first contact" — D6. "Built in Portugal, for Europe." sai da description para caber nos 160; fica no `/about` e no schema.)*
- **JSON-LD** (em `page.tsx`, num `<script type="application/ld+json">`; zero impacto visual):

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://www.sherlockdeal.com/#organization",
      "name": "Sherlock Deal",
      "alternateName": "SherlockDeal",
      "legalName": "Exotictarget, Lda",
      "url": "https://www.sherlockdeal.com",
      "logo": "https://www.sherlockdeal.com/icon.svg",
      "description": "Sherlock Deal is a fundraising workspace and matching platform that connects startups with the investors that fit them, built in Portugal for Europe.",
      "address": { "@type": "PostalAddress", "addressLocality": "Viana do Castelo", "addressCountry": "PT" },
      "contactPoint": { "@type": "ContactPoint", "contactType": "customer support", "url": "https://www.sherlockdeal.com/contact" }
    },
    {
      "@type": "WebSite",
      "@id": "https://www.sherlockdeal.com/#website",
      "name": "Sherlock Deal",
      "alternateName": "SherlockDeal",
      "url": "https://www.sherlockdeal.com",
      "inLanguage": "en",
      "publisher": { "@id": "https://www.sherlockdeal.com/#organization" }
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://www.sherlockdeal.com/#application",
      "name": "Sherlock Deal",
      "applicationCategory": "BusinessApplication",
      "operatingSystem": "Web",
      "url": "https://www.sherlockdeal.com",
      "description": "Matches startups with investors by sector, stage, ticket size and geography, and runs the outreach pipeline, the data room and the readiness work of a fundraising round.",
      "publisher": { "@id": "https://www.sherlockdeal.com/#organization" },
      "offers": [
        { "@type": "Offer", "name": "Elementary, my dear", "price": "0", "priceCurrency": "EUR", "url": "https://www.sherlockdeal.com/#pricing", "description": "Free plan, no card required." },
        { "@type": "Offer", "name": "List of Suspects", "price": "85", "priceCurrency": "EUR", "url": "https://www.sherlockdeal.com/#pricing", "description": "Per month, or €756 per year." },
        { "@type": "Offer", "name": "It's the butler!", "price": "149", "priceCurrency": "EUR", "url": "https://www.sherlockdeal.com/#pricing", "description": "Per month, or €1,308 per year." }
      ]
    }
  ]
}
```
  Os preços e nomes **saem de `PLANS`** (não são escritos à mão no schema). `foundingDate`, `founder` e `sameAs` ficam de fora até à **D4**.

---

## 2. `/for-startups` (nova)

- **`<title>`:** `Sherlock Deal — How to find investors for your startup` (54 caracteres; o H1 é a versão longa)
- **`meta description`:** `A five-step method to find investors that fit your startup — sector, stage, ticket size, geography, recent activity — and how Sherlock Deal does it for you.` (156)
- **H1:** How to find the right investors for your startup (and why most lists fail)
- **Schema:** `HowTo` (os 5 passos) + `FAQPage` (as 5 perguntas) + `BreadcrumbList`.

---

**How to find the right investors for your startup (and why most lists fail)**

The right investors for your startup are the ones whose mandate already covers your sector, your stage, your round size and your country — and who have invested recently. Build a short list on those four facts, confirm your own numbers once, and approach each investor with one clear reason why you fit. Sherlock Deal does the matching for you.

### Why most investor lists fail

A list of investor names is a starting point, not a plan. Most lists fail for the same four reasons.

- **They are not matched to you.** A fund that invests only at Series A, or only in climate, will not answer a pre-seed health-tech founder, however good the pitch.
- **They go stale.** Funds close, partners move on and cheque sizes change. A list copied a year ago sends you to investors who no longer fit.
- **They give you a name, not a reason.** Without a reason why this investor and why now, your message looks like every other one in the inbox.
- **They have no order.** A hundred names with no ranking turns a round into a mailing exercise instead of a series of well-prepared conversations.

### A five-step method that works

1. **Get your own facts straight first.** Write down your sector, stage and country, how much you are raising, in which instrument, and what the money is for. Investors compare notes: a number that changes between conversations costs you credibility.
2. **Match on sector and stage.** Investors publish the sectors they back and the stages they invest in. Remove everyone whose stage range does not include yours or whose sectors do not include yours.
3. **Match on cheque size and geography.** Compare your round with the investor's typical cheque, and check where the investor invests: many funds invest only in certain countries or regions.
4. **Check recent activity.** Look at what the investor has backed over the last year or two. Is it your sector? Is it your stage? Is a new fund being deployed? An investor who has not made an investment in your area recently is a weaker bet than one who has.
5. **Plan the first contact.** One sentence on why this investor, one on what you do, one number that shows progress, and a clear ask — a 20-minute call, not "feedback". Have a one-page summary, a deck and the basic documents ready before you send anything.

### How Sherlock Deal does this for you

Sherlock Deal turns the method into a workflow. You confirm your company facts once. Sherlock Deal then scores every investor in its catalogue — more than 500 verified investor profiles across more than 25 European countries — against your company on sector, stage, ticket size and geography, and delivers the best matches to your pipeline every month. The Free plan brings up to 10 new curated investors a month; the paid plans bring up to 25 and up to 50 (curation starts once your profile has enough information to curate for). Each investor comes with their thesis, stage range, cheque size, the latest investment found where it is known, and the channel they publish for submissions, so you can check the fit yourself before you write.

Outreach then runs with discipline: daily and weekly targets you set (five a day and twenty a week by default), messages drafted from your confirmed facts and checked before they go, rules that stop you from contacting the same investor twice by accident, and nothing sent without your click. Documents go out through a data room with access set per investor and NDA protection where you want it. When your facts change, Sherlock Deal suggests investors from earlier conversations who deserve a second look.

**[Start free →]** *(mesmo CTA e destino da home: `/signup`)* — Free to start. No credit card required.

### Questions founders ask

*(as 5 perguntas do grupo C.1 da FAQ, §5 — texto idêntico, vindo do mesmo módulo de conteúdo)*

---

## 3. `/investors` — revisão (aditiva)

**O que NÃO muda:** hero, claim ("500+ … 25+"), método, features, split de acesso, pricing, CTA, as 4 perguntas da FAQ e a ordem das secções.

**3.1 Metadados:** `title` e `description` actuais **mantêm-se** (já começam por "Sherlock Deal" e descrevem o produto). `og:description` já é igual. Acrescenta-se JSON-LD (`Article` + `FAQPage`).

**3.2 FAQ — 3 perguntas novas** (no acordeão que já existe; o `FAQPage` passa a ter as 4 actuais + estas 3, todas lidas da **mesma lista** que a página desenha):

> **How do investors find startups that match their investment thesis?**
> They write the thesis down as criteria — sectors, stages, cheque range, geographies, instruments and exclusions — and have startups measured against it, instead of waiting for introductions. On Sherlock Deal an investor builds a mandate once; startups that match it arrive in curated waves, scored against the mandate with the criteria shown, and an introduction happens only when both sides opt in.

> **Can I compare startups side by side?**
> Yes. The comparison view puts startups next to each other on match score and the criteria behind it, round size and stage, together with your own scorecard and valuation estimate if you use them. Your scores and notes are private to your organisation; the founder never sees them.

> **Can I keep following startups I did not invest in, and re-evaluate them later?**
> Yes. Add a startup to your Watching list and choose what should bring it back to your attention: new evidence of traction, a new round or a changed target, a roadmap milestone, or a match score that rises above a level you set. The list, its order and the thresholds are private to you.

**3.3 Secção nova (visível — só com o teu "sim", D8)**, entre "Access" e "Pricing":

> **How to find startups that fit your thesis**
>
> The most reliable way to find startups that fit your thesis is to turn the thesis into criteria — sectors, stages, cheque range, geographies, instruments and exclusions — and have every startup measured against them before anyone sends you a deck. That is what Sherlock Deal does: you write your mandate once, and startups that match it reach you in curated waves, scored against your criteria.
>
> **What "fit" means in practice.** Every match is measured on sector, stage, cheque plausibility, geography and instrument. Exclusions are hard filters: a startup in a sector you exclude is scored zero instead of being ranked lower. Each match shows which criteria it met and which are still unconfirmed, so a missing fact is never counted as a match.
>
> **How Sherlock Deal delivers first contact.** Startups arrive in waves, and you work each wave — pass or express interest — before the next one opens. Your plan sets how many new startups arrive each month, so the pipeline stays workable. A startup appears in your pipeline only once its core profile is complete, and its evidence is labelled: fact, company claim, estimate, unknown or stale. You browse in private: founders are not notified while you look. When you want to go further, the introduction happens on MatchDeal, and only when both sides opt in. The first conversation is with a startup that already fits your mandate.
>
> **What you never see.** Sherlock Deal never shows investors a founder's internal performance data — not the founder's outreach activity, not their notes, and not where they stand with other investors. You see the profile the founder chose to show, and more only as the founder grants it.

*(CTA da secção: "Claim your investor profile" → `/claim`, o mesmo que a página já usa.)*

**3.4 JSON-LD:** `Article` (`headline`: "How to find startups that fit your thesis"; `author` e `publisher` = `Organization`; `dateModified` = data de revisão num ficheiro) + `FAQPage` (as 7 perguntas).

---

## 4. `/about` (nova)

- **`<title>`:** `Sherlock Deal — About: what it is and who runs it` (49)
- **`meta description`:** `Sherlock Deal is a fundraising workspace and matching platform for startups and investors, built in Portugal. What it does, who runs it and what it is not.` (155)
- **Schema:** `AboutPage` + `Organization` (`@id` da home) + `BreadcrumbList`.

---

**About Sherlock Deal**

Sherlock Deal is a fundraising workspace and matching platform that connects startups with the investors that fit them. Founders use it to find, approach and track investors; investors use it to receive startups that match their mandate. It was built in Portugal, and its investor catalogue covers more than 25 European countries.

### What it does

- **For startups:** matches your company against a catalogue of verified investors on sector, stage, ticket size and geography; runs your outreach with daily and weekly targets; keeps your confirmed facts consistent across every message and document; shares documents through a data room with per-investor access and NDA protection; and, on the paid plans, reviews your documents and prepares you for investor questions.
- **For investors:** lets you write your mandate once and receive startups that match it, in curated waves, with the fit explained; you browse in private, compare and follow startups, and an introduction happens only when both sides opt in.
- **For ecosystem organisations:** gives incubators, accelerators, university and corporate programmes, and public agencies a workspace to invite their startups, see what each founder chooses to share, publish open calls for applications and manage their team.

### Who it is for

Founders raising a round from pre-seed to Series A, mainly in Portugal and Europe. Business angels and angel networks, venture capital funds, corporate venture arms, family offices and public investment bodies. Incubators, accelerators and other ecosystem organisations.

### Who runs it

Sherlock Deal is operated by Exotictarget, Lda, a company registered in Portugal (Viana do Castelo). *(D4: confirmar; acrescentar "Founded by …" só se o Nuno quiser.)*

### How it is paid for

Sherlock Deal is paid for by subscription. Founders can start free, with no card required; paid plans raise the limits and add AI-personalised drafts and readiness reviews. Investors have their own plans, and accelerators, studios and funds that want to cover their portfolio companies can arrange a custom plan. Today Sherlock Deal takes no equity and no success fee. The plans and prices are on the [home page](/#pricing) and on the [investors page](/investors#pricing).

### What Sherlock Deal is not

Sherlock Deal is not an investor, a broker or a crowdfunding platform. It does not hold funds, does not give investment advice, and does not verify or guarantee any information, valuation or transaction. A match score is a guide, not a recommendation, and it creates no expectation of an introduction, a meeting or an investment. Any decision and any deal happen directly between the parties, outside the platform.

### How it treats founders' information

Investors see the profile a founder has chosen to show, and only once the core profile is complete; founders can hide their company from investors at any time. Documents are opened investor by investor, behind an NDA where the founder requires one. Sherlock Deal never shows investors a founder's internal performance data — such as outreach activity, notes, or where the founder stands with other investors.

### Where the investor catalogue comes from

The catalogue is compiled and verified from public sources. People and firms in it can read how their data is used, and ask for it to be corrected or removed, in the [privacy notice](/legal/privacy-notice) and through the [data-rights request](/privacy-request).

### Contact

Use the [contact form](/contact).

---

## 5. `/faq` (nova) — 20 perguntas, `FAQPage` com todas

- **`<title>`:** `Sherlock Deal — FAQ: finding investors, pricing, privacy` (56)
- **`meta description`:** `Answers on finding investors, preparing to raise, how Sherlock Deal matches startups and investors, pricing, privacy and what it does not do.` (141)
- **Formato:** `<details>` por pergunta (o texto está no HTML, o acordeão é só visual); cada resposta responde na primeira frase; "Sherlock Deal" por extenso em todos os grupos. Numeração interna `Q1…Q20` (rastreio; não aparece).

**Finding investment**

**Q1 — I'm looking for investment for my startup. Where do I start?**
Start with the facts about your own company: your stage, how much you are raising and what for, your country, and what you can show an investor in a first meeting — a one-page summary, a deck and the few numbers you can defend. Only then look for investors, because who fits depends on those facts. Sherlock Deal starts there too: you confirm your company facts once, and every investor match and every message uses only facts you have confirmed.

**Q2 — How do I find investors who are a good fit for my startup?**
A good-fit investor invests in your sector, at your stage, with cheques that suit your round and in your geography — and has been active recently. Check those four against each investor's published thesis, then look at their latest investments. Sherlock Deal does the first part for you: it scores every investor in its catalogue against your company on sector, stage, ticket size and geography, and delivers the best matches to your pipeline each month, with each investor's thesis, stage range and cheque size on file so you can check the fit yourself. *(link: [How to find the right investors for your startup](/for-startups))*

**Q3 — How do I find investors for a startup in Portugal?**
Portugal's early-stage investors are a small, well-connected group: business angels and angel networks, a handful of seed funds, public-backed funds, corporate programmes, and European funds that back Portuguese teams. Sherlock Deal was built in Portugal: its catalogue of verified investors covers Portugal and more than 25 other European countries, and geography is one of the four things every match is scored on.

**Q4 — How do I know whether my startup is ready to raise?**
You are ready when you can state your round — amount, instrument, use of funds and timeline — when your deck and business plan tell the same story, and when you can answer the questions every investor asks without looking anything up. Sherlock Deal helps in two ways. Your company becomes visible to investors only once its core profile is complete — nine basic facts, such as website, sector, stage, country and round size — and, on the paid plans, Readiness & Train reviews your documents, flags gaps and trains you on investor questions before you start.

**Q5 — How do I approach an investor and prepare the first contact?**
Lead with fit: one sentence on why this investor, one on what you do, one number that shows traction or progress, and one clear ask — a 20-minute call, not "feedback". Keep it short. In Sherlock Deal every message is drafted from your confirmed facts and the investor's profile — templates on every plan, AI-personalised drafts on the paid plans — and nothing is sent until you have reviewed it and clicked.

**How Sherlock Deal helps**

**Q6 — What is Sherlock Deal and how does it help with fundraising?**
Sherlock Deal is a fundraising workspace built in Portugal. It matches startups with the investors that fit them, keeps a startup's confirmed facts consistent across every message and document, runs the outreach pipeline with daily and weekly targets, and puts startups that match an investor's mandate in front of that investor. Founders use it to raise from pre-seed to Series A; investors use it from business angels to funds, family offices and ecosystem organisations.

**Q7 — How does Sherlock Deal assess alignment between a startup and an investor?**
On the criteria a mandate is written in. For founders, each investor in the catalogue is scored against the startup's sector, stage, round size and country, using what has been compiled and verified about the investor from public sources. For investors, startups are scored against the mandate the investor wrote — sectors, stages, cheque range, geographies and instruments — and an exclusion removes a startup outright. Founders see a fit rating next to the investor's own thesis, stage range and cheque size; investors see the match with the criteria that were met. A score is a guide, not a recommendation, and it never replaces your own judgement.

**Q8 — What's the difference between Sherlock Deal and an investor database?**
A database gives you names. Sherlock Deal gives you the investors that fit your company, with the channel each one publishes for submissions where one exists, the pipeline to run the round, protected outreach (message checks, daily limits, contact locks), an NDA-protected data room and, on the paid plans, readiness reviews. A database is an input; Sherlock Deal is the process.

**Q9 — Does Sherlock Deal help improve my pitch deck and prepare for investor questions?**
Yes, on the paid plans. Readiness & Train reviews your documents with AI, gives an investability reading and a prioritised action plan, and lets you practise the questions investors ask. Every suggestion is a proposal: you accept or reject it.

**Q10 — Can I manage investor contacts and track my round in Sherlock Deal?**
Yes. Every investor you work with sits in a pipeline with a stage, a next step and a history, and you can add your own investors without limit. Sherlock Deal sets daily and weekly outreach targets (five a day and twenty a week by default), tracks follow-ups, and suggests investors from earlier conversations who deserve a second look when your facts change.

**Getting started and sharing information**

**Q11 — Can I use Sherlock Deal at an early stage, or without a pitch deck?**
Yes. You can create an account and build your profile from your company facts alone, and add a deck and a business plan when you have them. Investors see your company only once its core profile is complete, and you can hide it at any time, so there is no harm in starting early.

**Q12 — Is Sherlock Deal only for Portuguese startups?**
No. Sherlock Deal was built in Portugal, but a startup from any country can create an account. The investor catalogue is European — verified investors in more than 25 countries — so matches are strongest for startups raising from European investors.

**Q13 — Do investors get automatic access to my documents and company information?**
No. Investors see the profile you have chosen to show, and only once your core profile is complete; you can hide your company at any time. What an investor learns grows in steps: the company overview once the investor expresses interest, team and traction details only if you grant them, and documents only through the data room. The data room is yours to control: you open each document, to each investor, and can require an NDA first. Sherlock Deal never shows investors your internal performance data — your outreach activity, your notes, or where you stand with other investors.

**Q14 — Can I use Sherlock Deal for free?**
Yes. The Free plan, "Elementary, my dear", costs €0 with no card required and no time limit. It includes your company profile and confirmed facts, a data room with access control and NDA-protected sharing, protected outreach, the MatchDeal discovery app, and up to 10 new curated investors a month once your profile has enough information to curate for. The paid plans — "List of Suspects" at €85 a month and "It's the butler!" at €149 a month, less when billed annually — raise those limits and add AI-personalised drafts and Readiness & Train. Every plan is listed in the [pricing section](/#pricing). *(os nomes, preços e limites são lidos de `plans.ts` no momento do render)*

**Q15 — Does Sherlock Deal invest directly, or guarantee that I'll raise?**
No, on both counts. Sherlock Deal is a tool, not a fund and not a broker: it does not invest, give investment advice or hold funds, and it cannot guarantee that you will raise or that any investor will respond. What it does is help you reach the right investors, with consistent facts, at a steady pace. Today it is paid for by subscription only. Any decision and any deal happen directly between you and the investor.

**Fundraising and first contact**

**Q16 — What is "first contact" in fundraising, and why does it matter?**
First contact is the first time an investor hears from a startup, and it sets the frame for what follows. A first contact that is clearly in scope — right sector, stage and cheque size, with the key facts ready — is easy for an investor to act on; one that is out of scope is easy to ignore. For founders, Sherlock Deal helps make the first contact a fit: it matches before you write, and drafts from confirmed facts. For investors, it brings startups that match the mandate into a curated pipeline, so the first conversation is with a startup that already fits; introductions happen only when both sides opt in.

**Q17 — How many investors should a startup contact to close a pre-seed or seed round?**
Dozens, not hundreds: most founders work a list of a few dozen well-matched investors, in waves, rather than mass-emailing. A shorter list of investors who really fit beats a long list of ones who do not, because fit decides who replies. Sherlock Deal paces outreach — five contacts a day and twenty a week by default — so you can work a list in waves and follow up properly.

**Q18 — What do investors want to see before a first meeting?**
Three things: a clear statement of what you do and for whom, in one page; evidence of progress — a few numbers you can defend, such as revenue, users, pilots or milestones; and a round that makes sense — amount, instrument and use of funds. A deck helps, but most investors decide from the first page whether to take the meeting. Sherlock Deal keeps these facts consistent across your profile, your messages and your data room. *(link: [How to find the right investors for your startup](/for-startups))*

**For investors and ecosystem organisations**

**Q19 — How do investors find startups that match their investment thesis?**
They write the thesis down as criteria — sectors, stages, cheque range, geographies, instruments and exclusions — and have startups measured against it, instead of waiting for introductions. On Sherlock Deal an investor builds a mandate once; startups that match it arrive in curated waves, scored against the mandate with the criteria shown; browsing is private, and an introduction happens only when both sides opt in. *(link: [Sherlock Deal for investors](/investors))*

**Q20 — Is Sherlock Deal a platform for incubators and accelerators?**
Yes. Incubators, accelerators, university and corporate programmes, public agencies and other ecosystem organisations have their own workspace: they invite their startups into a portfolio, see what each founder chooses to share — the company profile, confirmed facts and roadmap, and optionally the readiness analysis — publish open calls for applications, and manage their team. The founder decides what is shared; documents and fundraising details are not shared with a programme.

---

## 6. Navegação e rodapé (§E + §F)

**Páginas novas** (nav e rodapé próprios, com os estilos da landing):
- **Nav:** logótipo · Features · How it works · Pricing (apontam para `/#…`) · **For Startups** (`/for-startups`) · **For Investors** (`/investors`) · Sign in · Create account.
- **Rodapé em três colunas (§E):** *Product* — Features, How it works, Pricing, For startups, For investors · *Company* — About, FAQ, Contact · *Legal* — Privacy notice, Data-rights request, Suppliers, Terms. Linha final: "© {ano} Sherlock Deal · Investor relations, investigated."
- Ligações cruzadas (§E): as páginas-guia ligam entre si e à FAQ; a FAQ liga a `/for-startups` (Q2, Q18) e a `/investors` (Q19).

**Toques na home (cada um só com "sim"):**
1. **F1 — Nav:** o item "For Startups" do `AudienceToggle` passa de `/` para `/for-startups`. *(Nota em D7.)*
2. **F2 — Rodapé (versão mínima recomendada):** acrescentar **About** (`/about`) e **FAQ** (`/faq`) à linha de links que já existe, no mesmo estilo; não reorganizar em colunas.
3. **F3 — Linha por baixo do H1:** um parágrafo no estilo do subtítulo actual:
   > Sherlock Deal matches startups with the investors that fit them, and puts startups that match their mandate in front of investors.
   *(substitui "most likely to say yes … first contact" — D3/D6.)*

---

## 7. Especificação técnica (para aprovação)

### 7.1 `robots.txt` (reescreve `src/app/robots.ts`; actualiza os testes do 514)

Cada grupo repete os `Disallow` privados (um crawler só segue o grupo mais específico para ele).

| Bot | Hoje (514, não servido) | Proposto | Porquê |
|---|---|---|---|
| `*` (motores normais: Googlebot, DuckDuckBot…) | `allow /`, `disallow /guest/ /api/` | **igual + a app autenticada em `Disallow`** | só higiene; as rotas privadas já exigem login |
| `OAI-SearchBot`, `ChatGPT-User` | bloqueados | **permitidos** | pesquisa do ChatGPT e abertura de páginas pedida pelo utilizador |
| `PerplexityBot`, `Perplexity-User` | bloqueados | **permitidos** | índice e abertura de páginas do Perplexity |
| `Claude-SearchBot`, `Claude-User` | bloqueados | **permitidos** | pesquisa do Claude e abertura de páginas pedida pelo utilizador |
| `Bingbot`, `Applebot` | permitidos (grupo `*`) | **permitidos** | o Bing alimenta o ChatGPT search e o Copilot; Applebot alimenta Siri/Spotlight |
| `GPTBot`, `ClaudeBot` (+ legados `anthropic-ai`, `Claude-Web`), `Google-Extended`, `Applebot-Extended` | bloqueados | **permitidos** (nomeados por ti) | conhecimento dos modelos sem pesquisa (Gemini, ChatGPT, Claude, Apple Intelligence); uso do texto **público** de marketing |
| `CCBot`, `Bytespider`, `TikTokSpider`, `Meta-ExternalAgent`, `Meta-ExternalFetcher`, `FacebookBot`, `Amazonbot`, `cohere-*`, `MistralAI-User`, `AI2Bot`, `Diffbot`, `Omgili*`, `Timpibot`, `ImagesiftBot` | bloqueados | **continuam bloqueados** | fora do objectivo; reversível quando quiseres |
| `YouBot` (You.com) | bloqueado | **permitido** | é um motor de resposta |

`Sitemap: https://www.sherlockdeal.com/sitemap.xml`. `Disallow` para todos: `/api/`, `/guest/`, `/call/`, `/backoffice/`, `/metrics/`, `/login`, `/signup`, `/settings`, `/pipeline`, `/today`, `/agenda`, `/dashboard`, `/entities/`, `/people/`, `/documents`, `/outbox`, `/automations`, `/packs`, `/queue`, `/log`, `/import`, `/needs-review`, `/readiness`, `/plans`, `/network`, `/messages`, `/tasks`, `/calls`, `/matchdeal/`, `/pair`, `/portal`, `/ecosystem`, `/incubator`, `/claim`, `/invite/`, `/welcome`, `/company`, `/catalog-people`, `/set-password`, `/reset-password`, `/forgot-password`, `/suspended`, `/blocked`, `/closed`. (O prompt dizia `/app/`: não existe — a app vive em caminhos de topo.) **Salvaguarda:** um teste falha se aparecer uma pasta nova em `src/app` que não esteja classificada como pública ou como `Disallow`.

### 7.2 `sitemap.xml` (`src/app/sitemap.ts`)

`/`, `/investors`, `/for-startups`, `/about`, `/faq`, `/contact`, `/terms`, `/legal/privacy-notice`, `/legal/subprocessors`. `lastModified` por página, constantes que só mudam quando o conteúdo muda (nunca `new Date()`). Futuras: `/compare`, `/pt/*`. Nada autenticado. O teste confirma que **cada URL do sitemap passa o middleware sem sessão**.

### 7.3 O resto do JSON-LD

`HowTo` (`/for-startups`, 5 passos), `Article` + `FAQPage` (`/investors`), `AboutPage` (`/about`), `FAQPage` (`/faq`, 20 perguntas), `BreadcrumbList` nas páginas novas. **O JSON-LD de FAQ é gerado da mesma lista que a página desenha** (um teste compara-os), para o schema nunca descrever texto que não está visível.

### 7.4 Fora do pedido, para saberes

`llms.txt`: não incluído (nenhum motor grande o documenta como sinal). Imagem OG: D10. Versão PT (`/pt/faq`, `/pt/for-startups`, `hreflang`): fase 2, só depois de §A–C em produção.

---

## 8. TODO registados (não entram agora)

**Segunda lista (§C.5)** — páginas futuras: investidores internacionais; antes de abrir ronda; informação necessária para as recomendações; as recomendações actualizam com a evolução; (investidores) analisar e comparar oportunidades *(já coberto na pergunta "compare" de `/investors`)*; acompanhar startups em que não investiu e reavaliar *(idem: "Watching")*; (incubadoras) preparar as startups do programa; dificuldades comuns e necessidades de apoio *(o workspace actual não tem leitura agregada — só avançar se vier a existir)*.

---

## 9. O que faço depois do teu "sim" (e o que não toco)

1. `src/lib/public-site-routes.ts` + middleware + shell + testes (D2).
2. `robots.ts` e `sitemap.ts` + testes (D1).
3. Componente `JsonLd` + construtores de schema (uma fonte para FAQ/plans) + testes.
4. Páginas `/for-startups`, `/about`, `/faq` (estilos novos num CSS module próprio que reutiliza as variáveis da landing; a landing não é tocada).
5. `/investors`: metadados + JSON-LD + 3 perguntas (+ secção, se D8 = sim).
6. Home: metadados + JSON-LD (+ F1/F2/F3 conforme as tuas respostas).
7. Verificação (§H): `tsc`/`lint`/`build` por código de saída; JSON-LD no Rich Results Test e no Schema Markup Validator (capturas); `robots.txt`/`sitemap.xml` por `curl` em produção (o `dev:verify` não apanha o middleware); Lighthouse SEO ≥ 95 nas três páginas novas; **capturas da home antes/depois** (devem ser idênticas, salvo o que aprovares em F); "sim" para o merge; `buildId`.
8. **Não toco:** componentes, estilos ou copy da landing além do §F; o 919; o portal; nenhum blog; nenhum número que não esteja confirmado.

Depois do deploy (tu): Google Search Console e Bing Webmaster Tools (pedir indexação das páginas novas; o Bing pesa para o ChatGPT/Copilot) e as entradas de entidade fora do código (Wikidata, Crunchbase, Dealroom, LinkedIn, Startup Portugal) com a frase de uma linha da meta description; os URLs voltam para o `sameAs` num adenda.
