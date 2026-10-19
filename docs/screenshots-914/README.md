# Prompt 914 — captura do banner de plano com origem

`plans-banner-free-trial-origin.jpg` — o cartão **"Your plan"** da página Plans & billing, com uma org `zz-test-914` guardada em
`idea` e um resgate de 100% em curso: **"It's the butler! €0/month — It's the butler! — free trial via PIONEER_100 until 08 Jan 2027"**.
(O popup por cima é o tour de página, que destaca o cartão; não faz parte do que se verifica.)

Como foi tirada (13/10/2026, `npm run dev:verify`, modo demo, `/api/me` com `verifyIdentity` = esta pasta e o HEAD `c5f7967d`):
uma página-andaime descartável montou o **`PlansPanel` real**; o `/api/me` de substituição correu o **código real**
(`effectivePlanDetailForOrg`) sobre uma base em memória (`fakeDb`) com a org e o resgate — por isso o plano e a origem que o ecrã mostra
saem da regra, não de um literal. A página-andaime e o endpoint foram apagados antes do commit e o servidor foi parado.

Não alcançado no browser, dito: a linha "Plan" do cartão Organisation (só pede o `/api/me` com a autenticação ligada, que o
`dev:verify` desliga) — coberta por `src/components/PlanRow.test.ts`; e a tabela Startups do back-office (precisa de sessão de
administrador) — o pipeline e o limite de créditos por linha correm o mesmo código que os testes de `effective-plan-readers.test.ts` cobrem.
