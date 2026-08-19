-- =============================================================================
-- 0188_catalog_form_questions.sql
--
-- ESTADO: PROPOSTO. NAO APLICADO. Requer decisao do Nuno antes de correr.
-- A sessao Code nunca chama apply_migration -- fica para o revisor aplicar.
--
-- Ficheiro companheiro: prompt_265_webform_assistant_painel_lateral_20260819.md
-- =============================================================================
-- Prompt 265 §7/§8 — memoria partilhada das perguntas de um form de
-- submissao (nunca das respostas, que sao estrategia privada do founder —
-- root rule de privacidade, mesmo espirito, sentido inverso). Uma linha por
-- catalog_entities: a proxima startup que escolher "Web form" para o MESMO
-- investidor reutiliza as perguntas ja extraidas, sem gastar uma chamada AI.
--
-- Chave e catalog_id, nao entity_id: entities e por-org e privado (o texto
-- do formulario nao e), catalog_entities e a identidade partilhada do
-- investidor entre orgs (mesmo padrao ja usado por catalog_deliveries,
-- catalog_people, etc.). Uma entidade so alimenta/le esta tabela quando
-- resolve a um catalog_id via catalog_deliveries (entidades 'manual' sem
-- link ao catalogo simplesmente nao participam na memoria partilhada --
-- ainda funcionam, extraem para si proprias a cada vez, sem cache).
create table if not exists catalog_form_questions (
  id uuid primary key default gen_random_uuid(),
  catalog_id uuid not null references catalog_entities(id) on delete cascade,
  form_url text not null,
  -- [{label: string, type: string|null}], na ordem extraida/colada.
  questions jsonb not null default '[]'::jsonb,
  extracted_at timestamptz not null default now(),
  unique (catalog_id)
);

alter table catalog_form_questions enable row level security;

-- Conteudo publico do proprio form do investidor (o mesmo que qualquer
-- visitante da pagina ve) -- sem sensibilidade de privacidade em SELECT,
-- por isso legivel a qualquer sessao autenticada (founder ou investidor),
-- mesmo padrao de "sem custo de leitura" que catalog_entities ja usa para
-- os seus campos verificados. Escrita so por service-role (a rota server
-- e a unica escrevente -- nenhuma policy de insert/update/delete aqui,
-- deliberado).
create policy catalog_form_questions_select on catalog_form_questions
  for select using (auth.role() = 'authenticated');
