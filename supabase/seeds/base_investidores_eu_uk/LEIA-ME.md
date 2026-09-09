# Base_Investidores_EU_UK_v2 — pacote para importação (Prompt 639 + 640)

**Substitui o pacote v1.** A v2 é um superconjunto estrito da v1: 0 linhas alteradas, 0 removidas, IDs estáveis (INV001–035, PER0001–0248).

Conteúdo:
- Base_Investidores_EU_UK_v2.xlsx — original do Nuno
- Investidores.csv (35) · Pessoas.csv (248) · Conteudos_Hooks.csv (108) · Sinais_Pessoais.csv (29) · Fontes.csv (471) · Cobertura.csv (35)
- reconciliacao_investidores.csv — 35 linhas; 31 existem no catálogo, **4 NOVAS** (INV030 Fink, INV031 DIG, INV032 Smedvig, INV035 Empirical)
- reconciliacao_pessoas.csv — 248 linhas: CRIAR 156 · ACTUALIZAR 91 · AFILIAR_EXISTENTE 1

Reconciliação feita em produção a 9 Set 2026 (normalize_person_name, por firma; domínio para entidades).
Colocar em: supabase/seeds/base_investidores_eu_uk/ (substituindo o v1 se já lá estiver).
