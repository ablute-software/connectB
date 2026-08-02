# Prompt 90 — os quatro problemas, um a um, com evidência

Ordem seguida: a prioridade sugerida no próprio prompt (3c → 3a/3b → 1 → 2), exceto que 2 acabou por
ter causa raiz óbvia por código, por isso foi resolvido também, não só investigado.

---

## 3c — baralho cíclico da conta `nunomarujo@ablute.pt` — CORRIGIDO

**Causa raiz, confirmada por SQL, não adivinhada**: a migração `20260801004323_matchdeal_deck_replay_mode`
(já aplicada em produção) só ligou `deck_replay_mode = true` no perfil **investidor**
(`7acf223d-711e-4794-a37b-be2e8743c71e`) desta conta. Mas `nunomarujo@ablute.pt` é também `owner` do
org ablute_ (`bca54499-03c8-469b-a48d-b9f442e44f69`), que tem o seu **próprio** perfil MatchDeal —
desta vez `kind = 'startup'` (`fc9974e7-fed8-4130-bd92-3cb17090b2bf`) — e esse continuava com
`deck_replay_mode = false`.

Confirmado que foi mesmo esse o caminho que produziu o erro: esse perfil startup tinha exatamente
**7 swipes** (5 like + 2 pass) contra exatamente **7 perfis investidor visíveis** no sistema — baralho
100% esgotado, e sem `deck_replay_mode`, `matchdeal_eligible_deck()` exclui permanentemente qualquer
perfil já votado. Bate, ao pormenor, com "you've seen every investor for this week".

**Fix aplicado** (SQL direto, mesma coluna/mecanismo já aprovado em
`mini_prompt_ok_deck_replay_mode_e_mini_pitch_novo_20260801.md` — não é schema novo, é a mesma regra
estendida ao segundo perfil da mesma pessoa):
```sql
update matchdeal_profiles set deck_replay_mode = true
where id = 'fc9974e7-fed8-4130-bd92-3cb17090b2bf';
```
Aplicado. Confirmado por `returning`: `{"kind":"startup","deck_replay_mode":true}`. Não toca em nenhuma
conta real — só nos dois perfis (investidor e startup) da mesma conta de teste.

---

## 2 — botão de logout desaparece no Investor Workspace — CORRIGIDO

**Causa raiz, confirmada por código, não por tentativa de reprodução**: `InvestorWorkspaceShell.tsx`
tinha o único botão "Log out" dentro de `<aside className="... hidden w-60 flex-col ... md:flex">` —
ou seja, **abaixo de ~768px de largura, a barra lateral inteira desaparece, sempre**, não
intermitentemente. Não há nenhum menu mobile alternativo no ficheiro (confirmado por grep — zero
ocorrências de `md:hidden`/mobile/hamburger fora deste `md:flex`). Isto não é uma regressão pontual:
é 100% reprodutível em qualquer viewport estreito, o que bate com "é frequente" se testarem
principalmente no telemóvel.

Achado colateral: a shell do founder (`shell.tsx`) tem exatamente o mesmo padrão para o SEU botão de
logout (dentro do `aside` desktop-only) — mas essa tem uma nav mobile própria (rodapé, `md:hidden`)
que não inclui logout. Não mexi na shell do founder — fora do que foi reportado, e mudar aí é um
segundo ponto de decisão (a nav de rodapé do founder já está cheia com os 7 itens, um botão extra ali
precisa de desenho próprio). Fica sinalizado, não corrigido.

**Fix aplicado**: `InvestorWorkspaceShell.tsx` já tinha um `<header>` que renderiza em todas as
larguras (usado para o botão MatchDeal e o contador "Today"). Acrescentei aí um botão "Log out"
visível só em mobile (`md:hidden` — o desktop continua a usar o da barra lateral, sem duplicar).
`tsc`/`vitest`/`build` limpos.

---

## 3a — pairing por QR a pedir email+password no telemóvel — investigado, causa raiz confirmada, SEM fix aplicado (decisão de segurança/design)

**O que o Prompt 90 pediu para confirmar**: se o mecanismo real é o magic-link OTP automático da Edge
Function `matchdeal-pair`, ou outra coisa.

**Confirmado por código**: a Edge Function `matchdeal-pair` (o desenho OTP original) é **código morto**
— zero referências em todo o `src/`. O que está realmente em produção é o sistema de pairing por QR
"v2" (Prompt 82/84): `/api/matchdeal/pairing/generate` cria um token opaco de 5 min, o telemóvel abre
`app.sherlockdeal.com/pair?token=...`, e **esse ecrã exige que o próprio telemóvel tenha sessão Supabase
ativa** — se não tiver, manda para `/login` normal (email+password), exatamente o que reportaram.

**Isto não é bug — é desenho de segurança deliberado**, confirmado ao ler `consumePairingToken()`
(`src/lib/matchdeal-pairing.ts`): o token sozinho não basta para emparelhar — o servidor verifica que
quem está a consumir o token (`callerOrgId`, resolvido da sessão do telemóvel) é o MESMO org do token,
precisamente para que uma QR fotografada por um estranho por cima do ombro não consiga emparelhar um
dispositivo alheio sem também se autenticar como o dono da conta. Tirar esta exigência seria abrir essa
porta — não fiz isso sem OK explícito.

**O que É um gap real**: a UX é fricção total (email+password) em vez de algo mais leve tipo
magic-link, o que quebra a comparação ao WhatsApp que fizeram. A forma correta de resolver isto sem
enfraquecer a segurança seria o telemóvel já ter sessão persistida de um login anterior neste mesmo
browser (aí nunca pediria nada) — se isso não está a acontecer, o problema pode ser sessão a não
persistir no browser do telemóvel, não o desenho do pairing em si. **Não sei dizer qual dos dois sem
reproduzir com o vosso telemóvel real** — pedimos que, da próxima vez, confirmem se já tinham sessão
aberta em sherlockdeal.com nesse mesmo browser do telemóvel antes de ler o QR.

**Proposta, não aplicada**: se quiserem mesmo eliminar a fricção sem reduzir segurança, a opção limpa é
gerar, no momento de `generate()`, um magic-link real do Supabase (admin API) escopado só à conta que
pediu o QR, embutido no `pairUrl`, que `/pair/page.tsx` troca automaticamente por uma sessão ao
carregar — mantém a mesma verificação de identidade (é a mesma conta), sem pedir password. É trabalho
novo, com uma superfície de segurança que merece o vosso OK antes de escrever.

---

## 3b — depois do login, apareceu a app normal em vez do deck — investigado, NÃO reproduzido, código parece correto

Percorri toda a cadeia de redirect por código: `/pair/page.tsx` (`loginUrl` já embute
`next=/pair?token=...`), `/login/page.tsx` (usa `next` tanto no login por password como no magic-link,
via `emailRedirectTo`), `/auth/callback/route.ts` (redireciona para `next` só quando a troca do código
é bem-sucedida) e `src/middleware.ts` (`/pair` está na lista `PUBLIC`; o redirect "utilizador
autenticado sai de /login" só olha para `pathname === '/login'`, nunca para `/pair` — não há nenhum
código a desviar `/pair` para `/pipeline`). Não encontrei nenhum ponto na cadeia que explique o
telemóvel acabar na app normal.

**Não corrigi nada aqui** porque não localizei o defeito — corrigir às cegas sem saber a causa seria
adivinhar. Preciso de mais detalhe da próxima vez que acontecer: o que dizia a barra de endereço nesse
momento exato (ainda `/pair?token=...`, ou já outra coisa), e como esse link foi aberto (câmara → QR,
ou um link/marcador antigo). Sem isso, fica investigado e sem reprodução, não fechado como resolvido
nem como "não é nada".

---

## 3d — rodapé com separadores (Matches/Discover/Messages/Profile) — sem novidade

Confirmado, nada a fazer: já reportado no `NIGHT_LOG_20260802.md` (Item 10) que só "Discover" existe
hoje. Prompt 90 confirma que é a mesma coisa que o Nuno reparou — prioridade sobe quando entrar na fila
do Prompt 81 Bloco 5, mas não é um achado novo.

---

## 1 — Plans & Billing pós-login "desatualizado" — investigado, DESSINCRONIA NÃO ENCONTRADA no código

Verifiquei as 4 superfícies pedidas por código, não por captura de ecrã (a landing pública fica fora
de alcance autenticado, como já explicaram):
- `/` (founder) → `PricingSection.tsx` lê `PLANS` de `src/lib/plans.ts`.
- `/investors` → `InvestorPricingSection.tsx` lê `INVESTOR_PLANS` do mesmo ficheiro.
- `/plans` pós-login (founder) → `PlansPanel.tsx`, mesmo `PLANS`.
- Plans & billing pós-login (investidor, Prompt 74 Bloco 2) → `InvestorPlansPanel.tsx`, mesmo
  `INVESTOR_PLANS`.

**As quatro leem literalmente do mesmo array, no mesmo ficheiro — não encontrei nenhuma cópia de preço
duplicada em lado nenhum do resto do `src/`** (procurei por qualquer string `€NN` fora de
`lib/plans.ts` — só apareceram exemplos genéricos tipo "€12k" em placeholders, nada de preçário real).
`git log -- src/lib/plans.ts` mostra o último commit a tocar preços como sendo o Prompt 79
(`3f5ac2a`) — nada mais recente.

**Não consigo confirmar nem negar a dessincronia que reportaram sem saber que "últimas instruções de
preçário" são essas** — se houve uma instrução de mudança de preço mais recente que o Prompt 79, ela
não chegou a `lib/plans.ts`, e como as 4 superfícies partilham esse ficheiro, ou (a) nenhuma das
quatro tem os números novos ainda (não é dessincronia, é uma alteração pendente em todo o lado), ou
(b) o que viram na landing foi cache do browser/CDN e não reflete o código atual. **Preciso dos valores
novos exatos e de onde/quando foram pedidos** para agir — não vou adivinhar números de preço.

---

## Deploy confirmado

Commit `1135a23` em produção — confirmado por comportamento direto (GitHub Deployments API sem quota,
mesma situação da corrida da noite anterior): o chunk JS de `/portal` mudou de hash
(`page-60e121c696676144.js` → `page-d22d973fa10f1057.js`) e passou a conter 2 ocorrências de "Log out"
(a da barra lateral + a nova do cabeçalho mobile), batendo exatamente com o fix aplicado.

## Disciplina seguida

Evidência sempre, nunca memória — todas as causas acima confirmadas por grep/leitura de código ou SQL
direto, nenhuma por tentativa-erro. `access_grants` e o motor de matching não foram tocados em nenhum
dos itens. Schema: nenhum schema novo foi necessário — 3c reutilizou uma coluna e mecanismo já
aprovados; nada foi aplicado sem que já houvesse OK por escrito para exatamente essa coluna/mecanismo.
`tsc --noEmit`, `vitest` (316/316) e `npm run build` limpos depois das mudanças de código (item 2).
