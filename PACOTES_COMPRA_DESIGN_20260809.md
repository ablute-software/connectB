# Pacotes de compra — desenho (Prompt 143 + Prompt 42) — PROPOSTA, SEM CÓDIGO

Documento de desenho apenas. Nenhum ficheiro Stripe foi tocado para produzir isto — por
instrução explícita do Prompt 143 ("é dinheiro real, fica fora da autorização geral de
'corrige e avança'"). Fica à espera da tua confirmação antes de qualquer implementação.

## Porque é que isto é um bloco só, não dois

O Prompt 42 (incremento de quota do catálogo) e o Prompt 143 (comprar um boost extra) pedem
a mesma coisa em roupagens diferentes: **uma compra avulsa ("one-off") que credita algo
consumível**, não uma subscrição. Confirmei o estado real do billing existente antes de
propor isto:

- `checkout/route.ts` — `mode=subscription` **fixo** (`form.set('mode', 'subscription')`),
  sem parâmetro nenhum para o mudar. Um checkout `mode=payment` teria de ser um caminho novo,
  não um argumento a esta rota.
- `webhook/route.ts` — verifica a assinatura manualmente (HMAC, sem SDK), depois chama
  `billingEffectFromEvent` (função pura) e aplica com service role. **Não existe nenhuma
  tabela de eventos Stripe já processados** — o comentário do próprio ficheiro admite isto
  abertamente ("Idempotent by nature — replaying an event re-applies the same terminal
  state"), o que só é verdade porque o efeito de hoje é "define o plano para X", uma operação
  idempotente por natureza (repetir não acumula). **Um crédito consumível não tem essa
  propriedade** — repetir "credita +1 boost" sem uma guarda explícita duplica o crédito. Isto
  é a peça nova mais importante deste desenho, não um detalhe menor.

## Tabelas novas propostas

```sql
-- Créditos consumíveis. `kind` distingue os dois usos deste prompt/do 42.
create table public.org_credits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  kind text not null check (kind in ('catalog_quota', 'matchdeal_boost')),
  amount int not null check (amount > 0),
  remaining int not null check (remaining >= 0),
  source text not null, -- 'stripe_checkout' | 'manual_grant' (paridade com o padrão set-plan)
  stripe_checkout_session_id text,
  created_at timestamptz not null default now()
);

-- Idempotência por evento Stripe — a peça que falta hoje. Sem isto, um
-- retry do lado da Stripe (comportamento normal e documentado deles)
-- credita duas vezes.
create table public.stripe_processed_events (
  event_id text primary key,
  processed_at timestamptz not null default now()
);
```

`catalog_quota` já existe como coluna acumulada em `orgs` (ver `plan-sync.ts`) — um crédito
comprado deste `kind` soma-se a `orgs.catalog_quota` no momento do consumo (webhook aplica
directamente, `org_credits` fica como o registo/auditoria de onde veio cada unidade, não a
fonte de verdade do saldo — evita duas fontes de verdade para o mesmo número).

`matchdeal_boost` é genuinamente novo — hoje o boost é 1×/semana, de graça, por
`plan_tier='tier_b'` (`matchdeal_activate_super_like`). Um "comprar 1 boost extra" teria de
alterar essa função para aceitar um boost fora da janela semanal quando há `remaining > 0`
em `org_credits` — **essa alteração à função fica fora deste desenho** (é código real,
mencionado aqui só para que fiques a saber que existe um segundo passo depois desta
infraestrutura, não incluído no âmbito "só desenho" pedido).

## Fluxo de checkout avulso

1. Rota nova `POST /api/billing/checkout-onetime` (não reaproveita `checkout/route.ts` —
   `mode` é hoje uma constante nessa rota, e misturar subscrição com avulso na mesma rota é
   mais risco do que dois ficheiros pequenos e claros).
   - `mode=payment` (não `subscription`).
   - `line_items` com um price id de produto avulso (Stripe Price novo, não os de
     subscrição já mapeados em `stripePriceMap()`).
   - `metadata.org_id`, `metadata.kind` (`catalog_quota` | `matchdeal_boost`),
     `metadata.amount`.
2. Rota nova `POST /api/billing/webhook-onetime`, OU adicionar um `case` ao webhook
   existente para `checkout.session.completed` com `mode=payment` — **recomendo rota
   separada**: o webhook actual está desenhado à volta de `billingEffectFromEvent`
   (subscrição → plano), forçar um segundo tipo de efeito para dentro dessa função pura
   arrisca acoplar dois domínios que hoje são limpos.
   - Verifica a assinatura (mesmo código de `verify()`, extraído para partilhar).
   - **Primeiro passo, antes de qualquer escrita**: `insert into stripe_processed_events
     (event_id) values (...)` — se o insert falhar por PK duplicada, é um replay, responde
     200 e pára. Isto é o que falta hoje.
   - Só depois: insere a linha em `org_credits` (source='stripe_checkout') e aplica o
     efeito (`catalog_quota` soma directa em `orgs`; `matchdeal_boost` fica só como saldo em
     `org_credits`, à espera da alteração à função mencionada acima).

## O que fica deliberadamente por decidir aqui

- Preço de cada pacote (catálogo de quota extra, boost extra) — decisão de negócio, não
  técnica.
- Se `matchdeal_activate_super_like` deve mesmo passar a consumir `org_credits` quando a
  janela semanal grátis já foi usada, ou se um boost comprado é uma acção completamente
  separada (ex.: `matchdeal_activate_purchased_boost`, RPC nova, mais simples de raciocinar
  mas duplica lógica).
- Se `org_credits.kind='matchdeal_boost'` deve ser por `investor_member_id` (o mesmo scope
  do scorecard, Prompt 142) ou por `catalog_entity_id` (o fundo inteiro) — o boost em si é
  hoje por `matchdeal_profiles.id` (por seat), o que sugere per-seat, mas fica para
  confirmares.

**Pedido**: confirma se este desenho está certo antes de eu tocar em código nenhum de
Stripe. Sem essa confirmação, nada disto avança.
