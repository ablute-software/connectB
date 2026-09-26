-- RECUPERADA por introspecção directa de produção (supabase_migrations.schema_migrations.statements),
-- 2026-09-26 (Prompt 737, sessão diferente da autora). Aplicada às 17:20 UTC
-- por uma sessão a trabalhar no "Passo 3" do dossier de pessoa (importação do
-- showcase da Portugal Ventures), sem permissão de git push — nunca chegou a
-- um branch até agora. Ver schema_final_v2_revisto_passo3_20260926.md (pasta
-- do Nuno) para o desenho completo. NÃO reconstruída por esta sessão além da
-- introspecção — o texto abaixo é exactamente o que produção tem gravado.
--
-- Passo 3 do plano do dossier de pessoa (26/09/2026), parte 1/2.
-- Novos valores de evidence_kind isolados na sua própria transação porque
-- o Postgres não permite usar um valor de enum recém-criado dentro da
-- mesma transação em que foi adicionado (unsafe use of new value).
alter type evidence_kind add value 'role_history';
alter type evidence_kind add value 'education';
alter type evidence_kind add value 'portfolio_relationship';
