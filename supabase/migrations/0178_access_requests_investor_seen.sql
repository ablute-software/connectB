-- 0178 — PROPOSTO, NÃO APLICADO (o revisor aplica em produção).
--
-- Prompt 216 §C (lado do investidor) — "access requests respondidos
-- (granted/denied) por ver". A regra 2 do prompt exige que o badge limpe
-- quando os itens são vistos; um pedido respondido é informação (não há
-- mais nada a fazer nele), portanto "visto" é o que o resolve — e isso
-- precisa de um marcador persistente, exatamente o caso que a regra 3
-- prevê ("Se for preciso 'visto em', propor migração PROPOSTA").
--
-- Nullable, sem default: NULL = ainda não visto. Escrito apenas pela rota
-- service-role /api/portal/actions-required (POST ack) para as linhas do
-- próprio investidor (match por person_id/requested_email, o mesmo par que
-- identifica o dono do pedido desde a 0114). Zero mudanças de RLS: os
-- investidores continuam sem leitura direta da tabela (convenção da 0114 —
-- só via rotas service-role), e as policies do founder não são afetadas
-- por uma coluna nova.
alter table public.access_requests
  add column if not exists investor_seen_response_at timestamptz;
