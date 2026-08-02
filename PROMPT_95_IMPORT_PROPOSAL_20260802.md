# Prompt 95 — import de 66 investidores — APLICADO

**Confirmado por SQL, depois de aplicar**: `entities` tinha 691 linhas antes, tem **757 agora** — os 66
INSERTs corridos, todos com `returning id, name`, todos com o `org_id` correto (`757` no total = `757`
com esse `org_id`, ou seja nenhuma linha ficou fora). Breakdown por `type` das 66 novas, confirmado por
SQL: **58 vc, 7 public_body, 1 family_office** (bate: eram 59 vc nas 67 originais, menos 1 pela
Bertelsmann Investments excluída, que era `vc`).

## As duas decisões do Nuno, aplicadas exatamente como respondidas

1. **`source = 'manual'`** — usado tal como escolhido, sem alargar a `entities_source_check`. Proveniência
   fica só em `notes` (lote + "triagem Google Drive Tipo B"), como combinado.
2. **"Bertelsmann Investments" excluída** — não foi criada nenhuma linha nova para esta. A entidade já
   existente (`f3084ea1-febc-406e-89f3-a47ee293a4a8`) não foi tocada — fica registado, como pedido, que
   um possível UPDATE futuro (juntar o ângulo "BHI healthcare" às notas) é uma decisão separada, não
   feita agora.

**Contagem final: 66 entidades novas, não 68 nem 67** — a segunda correção do Nuno (68→66) confirmada.

---

CSV lido diretamente do ficheiro (parser CSV próprio, não transcrição manual — evita
exatamente o erro que "não inventem dados que não estão lá" queria prevenir). Confirmado: **67 linhas de
dados** no ficheiro (68 linhas incluindo cabeçalho) — bate com a correção do Nuno, sem duplicados de
`website` dentro do lote.

## 1. Bloqueio real — `source` proposto viola uma constraint existente

`entities_source_check`: `CHECK (source = ANY (ARRAY['catalog', 'manual', 'match_deal']))` — confirmado
por `pg_get_constraintdef`. O valor pedido, `'google_drive_import_2026-08-02'`, **não é permitido** —
tentar inserir com esse valor falha imediatamente, não é um aviso, é um erro duro.

**Duas opções, preciso que escolham uma**:
- (a) Usar `source = 'manual'` (já permitido) e manter a proveniência só em `notes` (que já tem
  `"Fonte: triagem Google Drive Tipo B, lote {batch}..."` — já é rastreável por texto, só não por
  filtro estruturado).
- (b) Propor uma migração pequena a alargar a constraint para aceitar um novo valor (`'google_drive_import'`
  ou parecido) — schema novo, à espera de OK como sempre.

O script já gerado usa (a) como placeholder, só para o SQL não ficar bloqueado à espera — **não é a
decisão, é só para não vos mandar um script que nem chega a correr.**

## 2. Um registo já existe — risco de duplicado real, não hipotético

Cruzei os 67 websites do CSV contra os 691 `entities` já existentes (nenhuma constraint `UNIQUE` a
proteger, como o Nuno já tinha confirmado) — **66 são genuinamente novos**. Um não é:

> **"Bertelsmann Investments" já existe** na tabela, `website = https://www.bertelsmann.com/en/divisions/bertelsmann-investments/`.
> O CSV traz o mesmo grupo com um website diferente (`bertelsmann-investments.com`) e um segundo problema
> à parte: o campo `website` do CSV contém **dois URLs concatenados** (`"https://www.bertelsmann-investments.com/
> ; healthcare: https://bhi.vc/"`), não um único URL limpo.

**Retirei esta linha do lote pronto a aplicar** — importar tal como está criaria um duplicado real do
mesmo grupo, o oposto da disciplina "uma abordagem por entidade" que é o core deste produto. Três
caminhos possíveis, à vossa escolha, não decidi sozinho:
- Ignorar esta linha (a entidade já existe, já está a ser trabalhada sob o nome/website antigo).
- Atualizar a linha existente (juntar `thesis`/`key_people`/`our_angle` novos ao registo já lá, sem
  duplicar).
- Criar como entidade nova mesmo assim, se considerarem que "Bertelsmann Investments" (geral) e
  "BHI — a vertente saúde" são, na prática, alvos de outreach distintos — mas nesse caso o `website`
  precisa de ser só um dos dois URLs, não os dois concatenados.

## 3. Confirmação positiva — o resto bate tudo certo

- `proposed_type` mapeado diretamente da coluna do CSV (não recalculado por mim) — `59 vc, 7 public_body,
  1 family_office`. Verifiquei a regra que descreveram (MBG/Förderbank/L-Bank → public_body) contra os
  valores reais do CSV: **zero discrepâncias** — a coluna já vem consistente com a regra.
  `type_confidence`: 63 "automática", 4 "confirmar manualmente" (Hevella, Maschmeyer, Marquard & Bahls,
  MARCARD STEIN & CO) — como já sinalizado, não bloqueante, ficam `vc` por omissão.
- `fit_score_enum` mapeado direto: `high 26, medium_high 16, medium 11, low 14`. Todos os 4 valores do
  enum `fit_score` (`high/medium_high/medium/low`) usados corretamente.
- `hq_country`: `country_hint` `DE`→`Germany` (63), `ES`→`Spain` (4) — nenhum outro valor no ficheiro.
- Todos os enums verificados contra a BD real (`entity_type`, `fit_score`, `entity_status`) — sem
  nenhum valor do CSV fora do que a coluna aceita.
- `org_id` confirmado por SQL: as 691 entidades existentes têm todas o mesmo `org_id`
  (`bca54499-03c8-469b-a48d-b9f442e44f69`) — usado para as novas.
- `entities_has_identity_evidence` (exige pelo menos um de `website`/`email_domain`/`phone`/`address`/
  `source_url`/`unverified_stub_at`): todas as 67 linhas têm `website`, constraint satisfeita.

## Exemplos de linhas transformadas (3 de 66, representativos)

```json
{
  "name": "Earlybird Venture Capital — Earlybird Health strategy",
  "website": "https://health.earlybird.com/", "website_verified": false,
  "hq_country": "Germany", "type": "vc", "fit_score": "high",
  "thesis": "Medical devices; diagnostics; Digital Health; ...",
  "key_people": "Dr. Christoph Massner is the strongest first target...",
  "our_angle": "Lead with the combination of device-enabled diagnostics...",
  "notes": "Fonte: triagem Google Drive Tipo B, lote DE_lote_profundo_16. Geografias de investimento (texto original): Europe-focused, with selected international healthcare investments. Ver também mini_prompt/prompt_95 no projeto Claude."
}
```
```json
{
  "name": "MBG Mittelständische Beteiligungsgesellschaft Baden-Württemberg GmbH",
  "website": "https://mbg-bw.ermoeglicher.de/", "website_verified": false,
  "hq_country": "Germany", "type": "public_body", "fit_score": "high",
  "thesis": "Sector-agnostic innovation; DeepTech; Life Sciences; MedTech; ...",
  "key_people": "Frank Kraheberger, Cornelius Baral or Sven Schatz; ...",
  "our_angle": "With a genuine regional operation, lead with MedTech precedent...",
  "notes": "Fonte: triagem Google Drive Tipo B, lote DE_lote_profundo_22. ..."
}
```
```json
{
  "name": "Kontora Family Office GmbH — an AlTi Tiedemann Global company",
  "website": "https://www.kontora.com/en/", "website_verified": false,
  "hq_country": "Germany", "type": "family_office", "fit_score": "low",
  "thesis": "Multi-asset wealth management; private markets; illiquid investments; ...",
  "key_people": "Dr Patrick Maurenbrecher or Stephan Buchwald only for LP/co-investment discussion",
  "our_angle": "Only through a trusted introduction, ask whether a client mandate seeks...",
  "notes": "Fonte: triagem Google Drive Tipo B, lote DE_lote_profundo_21. ..."
}
```

## Colunas em default, confirmadas como pedido

`status = 'not_contacted'`, `submission_channel_type = 'unknown'`, `hard_filter_status =
'not_applicable'`, `stage_min/stage_max/check_min_eur/check_max_eur/wave = NULL` — nada tocado além do
que o schema já define como default.

## O que está pronto para correr assim que confirmarem os pontos 1 e 2

66 `INSERT`s (script completo, gerado do CSV real, não transcrito à mão) — o placeholder `source =
'manual'` muda para o que decidirem no ponto 1; a linha da Bertelsmann Investments entra separadamente,
depois de decidirem o ponto 2. Aviso, como pedido, assim que as 67 (ou 66+1) linhas estiverem confirmadas
por SQL depois de aplicar.

## Disciplina seguida

Só a tabela `entities`, `access_grants` e motor de matching intocados. Nada aplicado — script pronto,
à espera de confirmação nos dois pontos acima antes de correr.
