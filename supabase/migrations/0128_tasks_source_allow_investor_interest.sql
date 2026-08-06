-- P135 §(c) — alarga tasks_source_check para aceitar 'investor_interest'.
--
-- APLICADA EM PRODUÇÃO A 05/08/2026 23:23:18 UTC pelo revisor (versão
-- 20260805232318 em supabase_migrations.schema_migrations), sem ficheiro no
-- repositório. Este ficheiro é a reconstrução verbatim do que está aplicado,
-- escrita idempotente, para o repositório voltar a ser fonte da verdade do
-- esquema. Aplicar num ambiente que já a tem é inofensivo.
--
-- PORQUÊ: o interesse do investidor passou a gerar uma tarefa real no Today
-- ("Respond to expressed interest", com due_at no instante em que o interesse
-- foi expresso, logo genuinamente atrasada, logo no cartão vermelho Overdue —
-- que é o comportamento persistente que o Nuno pediu). Sem este valor, a
-- alternativa era disfarçar a tarefa de 'manual', o que apagaria para sempre
-- a distinção entre "o founder escreveu isto" e "o sistema gerou isto a
-- partir de um interesse". Um valor novo custa uma linha; a ambiguidade
-- custa para sempre.
--
-- Estado anterior: CHECK (source IS NULL OR source = ANY (ARRAY['suggested','manual']))
-- Estado aplicado: CHECK (source IS NULL OR source = ANY (ARRAY['suggested','manual','investor_interest']))

alter table public.tasks
  drop constraint if exists tasks_source_check;

alter table public.tasks
  add constraint tasks_source_check
  check (source is null or source = any (array['suggested', 'manual', 'investor_interest']));
