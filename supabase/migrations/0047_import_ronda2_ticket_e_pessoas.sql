-- Ronda 2 do enriquecimento de catalog_entities (prompt 40, 2026-07-29).
-- Extensão de 0046: as 148 entidades restantes do conjunto "one field away"
-- de 348 (200 da ronda 1 + estas 148) foram pesquisadas. Este ficheiro cobre
-- as duas partes desta ronda:
--   1. check_min_eur/check_max_eur — 37 de 148 encontradas (25%, mais baixo
--      que a ronda 1 porque este lote tem entidades menos conhecidas/com
--      menos presença pública detalhada — dentro do esperado).
--   2. key_people — 39 entidades que tinham este campo vazio, preenchidas a
--      partir da mesma visita à página de equipa (sem custo extra de fetch).
--
-- Mesma disciplina da 0046: coalesce(existing, new) em todos os campos — só
-- preenche NULL/vazio, nunca sobrescreve. Confirmado ao vivo antes de
-- escrever este ficheiro: todos os 37 alvos de ticket tinham
-- check_min_eur/check_max_eur null, exceto Icebreaker.vc (check_max_eur já
-- = 1500000, coincide com o CSV) e Achmea Innovation Fund
-- (check_min_eur já = 500000, coincide com o CSV) — coalesce é no-op nos
-- dois casos, não há conflito. Todos os 39 alvos de key_people tinham o
-- campo null.
--
-- 8 entidades aparecem nos dois CSVs (Achmea Innovation Fund, Aglaé
-- Ventures, Anterra Capital, Emerge, henQ, Industrifonden, Karma Ventures,
-- Kima Ventures) — sem conflito, cada CSV escreve em colunas diferentes
-- (ticket vs key_people).
--
-- 3 das 39 pessoas vieram sem cargo, só nome (Sofinnova MD Start tem cargos
-- mas confidence 0.4 é baixa pela fonte; Maki.vc e Voima Ventures não têm
-- cargo nenhum, confidence 0.4 e 0.3) — importadas mesmo assim, com a
-- confidence baixa registada em notes para quem for rever mais tarde não
-- tratar como equivalente às entradas com cargo e confidence alta.
--
-- Sanity-checked programaticamente antes de escrever este ficheiro: nenhuma
-- linha com check_min_eur > check_max_eur, nenhum valor negativo, nenhum
-- valor acima de 1B EUR.
--
-- Confirm-then-apply, mesmo padrão que 0041-0046: NÃO aplicado ao escrever
-- este ficheiro.

-- ===== 1. Ticket range (37 entidades) =====

update catalog_entities set check_min_eur = coalesce(check_min_eur, 300000), check_max_eur = coalesce(check_max_eur, 3000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 round 2 (prompt 40) — confidence 0.75 — source: https://partechpartners.com/funds' where id = '082376fd-1f9c-4c58-bb19-c30f1224c43b';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 468000), check_max_eur = coalesce(check_max_eur, 585000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 round 2 (prompt 40) — converted from GBP 400000-500000 at approx fixed rate — confidence 0.75 — source: https://passioncapital.com/about/' where id = '548ecaac-c0f6-46be-9cd9-dc68257e443b';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 250000), check_max_eur = coalesce(check_max_eur, 4000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 round 2 (prompt 40) — confidence 0.75 — source: https://peak.capital/' where id = '96f78c6c-8262-4dd1-b6e7-0f1f0ae575bc';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 1000000), check_max_eur = coalesce(check_max_eur, 6000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 round 2 (prompt 40) — confidence 0.7 — source: https://www.project-a.vc/' where id = '435c6291-288a-45c5-ab15-4afe310948a0';
update catalog_entities set check_min_eur = coalesce(check_min_eur, null), check_max_eur = coalesce(check_max_eur, 1500000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 round 2 (prompt 40) — confidence 0.7 — source: https://www.scalehouse-capital.com' where id = '34d94920-9381-4e32-aff1-ccaf8037e369';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 2000000), check_max_eur = coalesce(check_max_eur, 7000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 round 2 (prompt 40) — confidence 0.7 — source: https://seaya.vc/seaya-ventures' where id = 'e0303284-378a-42fc-863d-4783841ab9d0';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 2000000), check_max_eur = coalesce(check_max_eur, 4000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 round 2 (prompt 40) — confidence 0.85 — source: https://www.seedcapital.dk/' where id = 'b095d1b1-329f-4a1e-8828-43cb6089b5b0';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 500000.0), check_max_eur = coalesce(check_max_eur, 2000000.0), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 round 2 (prompt 40) — confidence 0.7 — source: https://tvf.vc' where id = '1d4df894-31be-4b47-a88c-e2e32739c92d';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 100000.0), check_max_eur = coalesce(check_max_eur, 15000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 round 2 (prompt 40) — confidence 0.85 — source: https://serena.vc' where id = '47a6b06c-571e-4274-95bb-fc67c43b9d59';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 86000), check_max_eur = coalesce(check_max_eur, 430000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 round 2 (prompt 40) — converted from NOK 1000000-5000000 at approx fixed rate — confidence 0.85 — source: https://www.skyfall.vc/about' where id = '76f411ac-94ad-4b02-bd58-3fbf56a7377a';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 500000), check_max_eur = coalesce(check_max_eur, 3000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 round 2 (prompt 40) — confidence 0.9 — source: https://www.slingshot.ventures/' where id = '2698424d-bd70-4ecd-b307-9a254d41459c';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 500000), check_max_eur = coalesce(check_max_eur, 50000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 round 2 (prompt 40) — confidence 0.6 — source: https://smartfinvc.com/about-us/' where id = 'c6e0b1c6-cd74-4660-83ed-74fea696580f';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 100000), check_max_eur = coalesce(check_max_eur, 1000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 round 2 (prompt 40) — confidence 0.9 — source: https://smok.vc/' where id = 'c6181fe6-b644-43c0-9bf3-db343bb57595';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 250000), check_max_eur = coalesce(check_max_eur, 3000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 round 2 (prompt 40) — confidence 0.85 — source: https://specialist.vc/' where id = '6551e40c-2ed6-4405-9fa5-a8baf8bd43e3';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 300000), check_max_eur = coalesce(check_max_eur, 1000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 round 2 (prompt 40) — confidence 0.9 — source: https://superangel.io' where id = '626aaf8d-c07b-4bff-ae1f-200c3844eef3';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 200000), check_max_eur = coalesce(check_max_eur, 1000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 round 2 (prompt 40) — confidence 0.85 — source: https://trind.vc/the-trind-way' where id = '381376f0-8c6e-44be-bf66-889bbbcb3bc4';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 500000), check_max_eur = coalesce(check_max_eur, 10000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 round 2 (prompt 40) — confidence 0.9 — source: https://www.uvcpartners.com/' where id = 'fa3b6a16-eb39-4548-a25b-de13f8b7dd46';
update catalog_entities set check_min_eur = coalesce(check_min_eur, null), check_max_eur = coalesce(check_max_eur, 500000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 round 2 (prompt 40) — confidence 0.85 — source: https://vanagon.vc' where id = 'fa74e7bd-4b5f-4b0b-81a6-8d6bde694e82';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 500000), check_max_eur = coalesce(check_max_eur, 5000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 round 2 (prompt 40) — confidence 0.85 — source: https://ventechvc.com/who-we-are' where id = '49919c01-ac5a-4da0-9480-369ca44693fa';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 100000), check_max_eur = coalesce(check_max_eur, 5000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 round 2 (prompt 40) — confidence 0.85 — source: https://wind.capital' where id = 'f2bbbe43-5da6-4bf3-a2d6-2c7ae72ed1ef';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 500000), check_max_eur = coalesce(check_max_eur, null), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 round 2 (prompt 40) — confidence 0.6 — source: https://www.achmeainnovationfund.nl/en/' where id = 'eb9c77e0-cfdd-4682-b22a-68505f87c039';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 460000), check_max_eur = coalesce(check_max_eur, 92000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 round 2 (prompt 40) — converted from USD 500000-100000000 at approx fixed rate — confidence 0.6 — source: https://aglaeventures.com/' where id = '7ea40ccd-6ffe-4212-be2e-3606f83f7360';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 920000), check_max_eur = coalesce(check_max_eur, 9200000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 round 2 (prompt 40) — converted from USD 1000000-10000000 at approx fixed rate — confidence 0.9 — source: https://anterracapital.com/' where id = '4dbfb6a7-61c1-49ec-8dce-14f2c5a80bee';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 1000000), check_max_eur = coalesce(check_max_eur, 5000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 round 2 (prompt 40) — confidence 0.85 — source: https://www.basf.com/global/en/who-we-are/organization/group-companies/BASF_Venture-Capital' where id = '94aa766b-45b0-4166-a27d-11a17aa961bb';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 460000), check_max_eur = coalesce(check_max_eur, 2300000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 round 2 (prompt 40) — converted from USD 500000-2500000 at approx fixed rate — confidence 0.85 — source: https://emergecapital.vc/' where id = 'ab413b93-606c-438e-99a0-ceb026fa8242';
update catalog_entities set check_min_eur = coalesce(check_min_eur, null), check_max_eur = coalesce(check_max_eur, 2500000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 round 2 (prompt 40) — confidence 0.75 — source: https://faber.vc' where id = '2b615d82-6cc2-4635-8b34-00f3aaeee6d4';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 1170000), check_max_eur = coalesce(check_max_eur, 3510000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 round 2 (prompt 40) — converted from GBP 1000000-3000000 at approx fixed rate — confidence 0.75 — source: https://www.firstminute.capital/' where id = '8b56a3ef-6d33-426a-8488-d9101524bca3';
update catalog_entities set check_min_eur = coalesce(check_min_eur, null), check_max_eur = coalesce(check_max_eur, 10000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 round 2 (prompt 40) — confidence 0.85 — source: https://www.henq.vc/' where id = 'dc654ab3-188a-4280-a38e-e9dedf6e0d7d';
update catalog_entities set check_min_eur = coalesce(check_min_eur, null), check_max_eur = coalesce(check_max_eur, 1500000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 round 2 (prompt 40) — confidence 0.7 — source: https://www.icebreaker.vc/' where id = 'c4bbca5b-a7e7-462c-9d58-0242be2a9e1f';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 880000), check_max_eur = coalesce(check_max_eur, 4400000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 round 2 (prompt 40) — converted from SEK 10000000-50000000 at approx fixed rate — confidence 0.8 — source: https://industrifonden.com/' where id = 'fd37356b-f671-485d-9d03-d54319f73eb8';
update catalog_entities set check_min_eur = coalesce(check_min_eur, null), check_max_eur = coalesce(check_max_eur, 5000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 round 2 (prompt 40) — confidence 0.7 — source: https://www.karma.vc/' where id = '6b8d5231-65b1-427e-a254-0fa3b0ab05bb';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 150000), check_max_eur = coalesce(check_max_eur, 150000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 round 2 (prompt 40) — confidence 0.85 — source: https://www.kimaventures.com/' where id = '9b8da962-bfb3-451b-bac6-31711b0a0f96';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 20000), check_max_eur = coalesce(check_max_eur, 1500000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 round 2 (prompt 40) — confidence 0.7 — source: https://nation1.vc/' where id = '42963db8-6341-4d68-b7b4-011c076f80ca';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 500000), check_max_eur = coalesce(check_max_eur, 2000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 round 2 (prompt 40) — confidence 0.8 — source: https://paleblue.vc/' where id = '2472ae6a-c9bd-4e69-b7a8-878205b7ba97';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 117000), check_max_eur = coalesce(check_max_eur, 1755000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 round 2 (prompt 40) — converted from GBP 100000-1500000 at approx fixed rate — confidence 0.85 — source: https://playfair.vc/' where id = '73a93492-eca5-4b85-9019-8189e6d3dd1d';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 176000), check_max_eur = coalesce(check_max_eur, 585000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 round 2 (prompt 40) — converted from GBP 150000-500000 at approx fixed rate — confidence 0.7 — source: https://solidbond.com' where id = '45c5b198-0e27-4649-bd20-9cc46349d54e';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 1000000), check_max_eur = coalesce(check_max_eur, 15000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 round 2 (prompt 40) — confidence 0.85 — source: https://xange.vc/funds' where id = 'f4364048-78b5-455f-a837-c9fce1bb5869';

-- ===== 2. Key people (39 entidades) =====

update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Michel Casselman (General Manager); Geert Diericx (Executive Committee Member - Finance); Filip Lacquet (Executive Committee Member - Corporate Finance); Elke Van de Walle (Executive Committee Member - Legal Affairs and Audit); Roald Borré (Executive Committee Member - Equity Investments); Tine Vandenbussche (Executive Committee Member - Operations); Werner Decrem (Executive Committee Member - Infrastructure & Real Estate); Bart De Taeye (Head of Life Sciences & Care)'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.7 — source: https://www.pmv.eu/en/about-us/team-and-organisation/' where id = 'c1d240e8-6a24-4e25-8b02-6d370a1aac5f';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Helle Uth (Co-founder and General Partner); Alexander Viterbo-Horten (Co-founder and General Partner); Christel Piron (CEO PSV Foundry, Co-founder and General Partner); Richard Breiter (Co-founder and General Partner); Sebastian von Wildenrath Wegmann (Principal); Christian Dalsgaard (Investment Manager)'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.6 — source: https://www.psv.xyz/tech' where id = 'ab77b096-6246-43f7-9b86-489c459cf5eb';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Stephen Page (Chief Executive Officer); Angelika Burawska (Chief Operating Officer); Joseph Zipfel (Chief Investment Officer); Jason Druker (Chief Commercial Officer); Marguerite Crossfield (Chief Compliance Officer); Ed Prior (Head of Investor Services); Edward Stevenson (Principal); Adam Beveridge (Principal)'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.8 — source: https://sfccapital.com/about-us/' where id = '0c4b66c9-255d-4b13-89fd-b187a1caef35';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Sami Tuhkanen (Vice President, Investments); Juuso Janhonen (Portfolio Manager, Investments); Anne Ristola (Portfolio Manager, Private Equity Investments); Tiina Smolander (Portfolio Manager, Equity and Fixed Income Investments); Aarni Pursiainen (Portfolio Manager, Investments)'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.7 — source: https://www.sitra.fi/en/sitra-as-an-investor/' where id = 'dec6d495-3825-4081-8274-dc96267bf5e8';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Magne Uppman (Co-founder; former CEO of iProspect); Teodor Bjerrang (Co-founder; Founder and CEO of IXD)'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.7 — source: https://sno.vc/team' where id = 'b3577450-fda6-4af0-98a9-45ab019eddbb';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Antoine Papiernik (Managing Partner); Graziano Seghezzi (Managing Partner); Henrijette Richter (Managing Partner)'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.4 — source: https://sofinnovapartners.com' where id = 'bbb87ab0-ef8c-4b92-9de6-be3c3e69ca31';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Christina Takke (Managing Partner); Shelley Margetson (Managing Partner); Willem Broekaert (Managing Partner); Katja Rosenkranz (Partner); Ward Capoen (Partner); Mathias Falcenberg (Venture Partner); Martin Solleveld (Finance Manager); Tom Schwarz (Strategic Advisory Board)'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.8 — source: https://www.v-bio.ventures/' where id = 'c25efcd1-bffc-4f2d-85db-f1cd0a67be14';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Jasper Smith (Founder & Director); James Faulkner (Co-Founder & Managing Director); Jane Holland (Co-Founder & Advisor); Asker Fawmy (Co-Founder & Finance Director); Carolina Manhusen (Advisor); Jake Wombwell-Povey (Venture Partner); Naseer Randhawa (IT and Systems Manager); Paddy Willis (Investment Committee); Mike Penrose (Advisor and Investment Committee); John Swingewood (Investment Committee); Boyd Carson (Investment Committee)'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.75 — source: https://valacap.com' where id = 'b5ae0778-98e6-4295-92fc-957434b87330';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Markus Wanko (Core Team); Ingrid Kelly (Core Team); Alexander Schwartz (Core Team); Florian Resch (Core Team); Alexander Fischl (Core Team); Melanie Leisser (Core Team); Valentina Caradonio (Core Team); Sophia Hannes (Core Team); Annu Gmeiner (Core Team); Stephan Huber (Venture Partner); Erich Tauber (Operating Partner)'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.7 — source: https://xista.vc/' where id = 'a13e560a-369f-4b26-892c-01f1900dc35d';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Fausto Boni (Partner); François Tison (Partner); Cesare Maifredi (Partner); Alexandre Mordacq (Partner); Alessandro Zaccaria (Partner); Thomas Nivard (Partner); Lucrezia Lucotti (Partner); Jean-Marie Perrot (CFO & Head of ESG)'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.8 — source: https://www.360cap.vc/about-us' where id = 'ad177994-78b2-4ea4-82fc-1a4f4ba25e38';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Joline Slot (Administrative Officer AIF); Katharina Maass (Fund Manager); Henrieke Hoftijzer (Investment Director); Hans Peterse (Investment Associate); Derek van den Nieuwenhuijzen (Investment Associate); Victoria Haatainen-Cutler (Investment Manager)'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.8 — source: https://www.achmeainnovationfund.nl/en/team/' where id = 'eb9c77e0-cfdd-4682-b22a-68505f87c039';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Alain Huriez (Chairman and Managing Partner); Clément Bertholet (Managing Partner); Matthieu Coutet (Co-founder and Managing Partner); Mounia Azzi (Partner); Emma Gasol (Partner); Céline de Cosnac (CFO)'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.8 — source: https://adbio.partners/team/' where id = '3c53245f-05f8-4adc-a433-c75e7f6d0b47';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Cyril Guenoun (Early and Growth, Global); Miyuki Matsumoto (Early and Growth, US); Antoine Loison (Early and Growth, Global); Léa Verdillon (Early and Growth, France); Brendan Rempel (Early, US); Kristina Chvilova (Growth, Europe); Clémence Lamarque-Carité (AI, Global); Alexis Bonillo (Early and Growth, Global)'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.6 — source: https://aglaeventures.com/team/' where id = '7ea40ccd-6ffe-4212-be2e-3606f83f7360';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Adam Anders (Managing Partner & Co-founder); Phil Austin (Managing Partner & Co-founder); Maarten Goossens (Partner & Co-founder); Brett Wong (Partner); Brett Chevalier (Chief Scientist)'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.9 — source: https://anterracapital.com/team/' where id = '4dbfb6a7-61c1-49ec-8dce-14f2c5a80bee';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Lorin Van Nuland (Group CEO, Apeiron Investment Group); Nick Nigam (Head of Investments); Jefim Gewiet (Managing Director); Marc Weber (Chief Financial Officer); Jim Simpson (General Counsel)'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.7 — source: https://apeiron-investments.com/about/' where id = '17c16c89-254d-4ba2-b1fd-3cf308a289c2';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Christophe F. Maire (Investor); Marc-Olivier Lücke (Investor); Daniel Niemi (Investor); Lukas Erbguth (Investor); Bastian Bullmann (Investor); Quentin Calleja (Investor)'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.5 — source: https://atlantic.vc/team' where id = 'bb27ccd2-f610-4d41-9fdb-304f7ce795e9';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Dr. Aristotelis Nastos (Managing Partner); Dr. Markus Hosang (Managing Partner); Dr. Michael Wacker (Managing Partner); Thomas Möller (Managing Partner); Dr. Valentin Piëch (Managing Partner); Stefan Fäs (CFO & Partner)'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.85 — source: https://biomedvc.com/' where id = '6e9c6d45-7b2d-4dce-be9d-d12996ae9459';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Umberto Bottesini (CEO & General Partner); Sandro Moretti (Board Member & General Partner); Marco Caradonna (President & General Partner); Marcello Giordani (Partner); Antonio Dettoli (CFO)'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.85 — source: https://blacksheep.ventures/team' where id = '69a48e5d-5a81-4f13-8c33-679dc8e9f69d';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Catherine Lewis La Torre (Chief Executive Officer, British Patient Capital)'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.5 — source: https://www.british-business-bank.co.uk/news-and-events/news/catherine-lewis-la-torre-has-been-appointed-ceo-british-patient-capital-and-chair-british-business-investments-taking-up-the-roles-from-the-autumn' where id = 'f47fd18e-f941-4ba2-adf3-a5cc76d40159';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Mike Chalfen (Founder, Solo VC)'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.6 — source: https://chalfenventures.com/' where id = 'be3a2bbe-a9a6-4498-bb5b-baed9ac9a89f';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Jan Lynn-Matern (Founder & Partner); Nic Newman (Partner); Mario Barosevcic (Partner); Zara Zaman (Head of Platform); Sami Tatar (Senior Associate); Charlotte Jones (Research Operations); Chloe Trigg (Finance and Operations Manager)'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.8 — source: https://emergecapital.vc/community/' where id = 'ab413b93-606c-438e-99a0-ceb026fa8242';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Frederic Wohlwend (Managing Partner); Deborah Pittet (Partner); Jonas Jeandupeux (Principal); Labinot Braimi (Principal); Jannat Rajan (Principal); Julien van den Rul (Vice President); Nicolas Slotine (Vice President)'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.9 — source: https://www.forestay.vc/team-members' where id = '4786f7b1-f2bc-4289-b366-db53d6ce0958';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Rob Rousseau (Principal); Mick Mackaay (Partner); Jan Andriessen (Partner); Coen van Duiven (Partner)'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.85 — source: https://www.henq.vc/' where id = 'dc654ab3-188a-4280-a38e-e9dedf6e0d7d';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Peter Wolpert (CEO); Anna Ljungdahl (Senior Investment Director); Patrik Sobocki (Practice Lead Deep Tech, Senior Investment Director); Jonas Jendi (COO, Practice Lead Life Science, Senior Investment Director); Per Anell (Practice Lead Transformative Tech, Senior Investment Director); Tobias Elmquist (Senior Investment Director); Tore Tolke (Senior Investment Director); Anna Haupt (Investment Director)'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.9 — source: https://industrifonden.com/team/' where id = 'fd37356b-f671-485d-9d03-d54319f73eb8';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Mike Smeed (Managing Director); Sam Nasrolahi (Principal); Louis Fearn (Principal); Edouard Chavassieu (Associate); Maria Levin (Investment & Scouting Lead); William Morgan (Investment & Scouting Lead)'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.9 — source: https://www.inmotionventures.com/team/' where id = 'a4371018-7833-4c8e-9b99-992669f24cd0';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Tommi Uhari (Founding Partner); Margus Uudam (Founding Partner); Kristjan Laanemaa (Founding Partner); Ska Sijia Du (Principal); Linda Võeras (Venture Partner)'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.8 — source: https://www.karma.vc/people' where id = '6b8d5231-65b1-427e-a254-0fa3b0ab05bb';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Xavier Niel (Majority Shareholder); Jérémie Berrebi (Co-founder); Michel Sassano (Associate); Vincent Jacobs (Associate)'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.7 — source: https://www.kimaventures.com/team' where id = '9b8da962-bfb3-451b-bac6-31711b0a0f96';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Stefano Buono (Chairman)'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.5 — source: https://www.liftt.com/en/' where id = 'b804e324-1778-4921-a079-155fd08b9851';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Ilkka Kivimäki; Pirkka Palomäki; Josefiina Kotilainen; Paavo Räisänen; Pauliina Martikainen'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.4 — source: https://maki.vc/about' where id = '05c28d69-a977-4bd2-849e-0571b826e95d';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Marcin Kurek (Partner); Jacek Łubiński (Partner); Michał Mroczkowski (Partner); Jakub Ślusarczyk (Partner); Marcin Zabielski (Partner)'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.75 — source: https://www.moc.vc/team' where id = '223743ba-d301-4422-9b83-bf2911df6202';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Edward Twiddy (Chair); Alasdair Greig (CEO); Dominic Endicott (Strategic Adviser); Alex Buchan (Investment Director); Tom O''Neill (Investment Manager); Naomi Allen Seales (Investment Manager); Sean Nicolson (Commercial Partner); Emma O''Rourke (Finance Director); Will Cousins (Investment Manager)'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.75 — source: https://www.northstarventures.co.uk/our-team' where id = 'cdc02839-2b21-4158-811b-37d2a925a0aa';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Sofie Baeten (Managing Partner, Co-founder); Steven Leuridan (Partner, Co-founder); Cédric Van Nevel (Partner, Co-founder); Sara Vandenwijngaert (Chief Scientific Director); Danny Gonnissen (CFO)'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.75 — source: https://www.qbic.be/team' where id = '5dc6248e-bd27-4575-a2df-c645036a4230';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Patric Hoffmann (Head of Schenker Ventures); Tobias Ledermann (Head of Venture Building); Paulina Banszerus (Investment Manager); Niklas Lechner (Venture Partner)'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.7 — source: https://www.schenker-ventures.com/team' where id = '3eae2440-0dcd-4e1f-9cec-361a49bc7ea4';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Calum Paterson (Chairman & Senior Partner); Angus Conroy (Managing Partner); Keith Davidson (Managing Partner); Andrew Davison (Partner); Jan Rutherford (Partner); Tim Ankers (Partner)'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.8 — source: https://www.sep.co.uk/team' where id = '9df85669-7ed5-466c-84e5-46c235959725';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Mark Boggett (CEO & General Partner); James Bruegger (CIO & General Partner); Rob Desborough (General Partner); Sarah Shackleton (COO & Partner); Kenny Mumford (General Counsel & Partner)'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.8 — source: https://seraphim.vc/about/team/' where id = 'bf841a85-d9c8-45c5-9ce1-01bf870a928a';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'René Savelsberg (Co-Founder & Partner); Wouter Jonk (Co-Founder & Partner); Anton Arts (Managing Partner); Julia Padberg (Partner); Till Stenzel (Partner)'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.7 — source: https://setventures.com/set-ventures-team-2/' where id = '5948eb0e-0919-4ad0-bbb2-92ca59bc5c0e';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Finn Persson (Partner & Co-founder); Erik Wenngren (Partner & Co-founder); Sami Niemi (Partner); Peter Carlsson (Partner); Helen Agering (Partner)'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.8 — source: https://spintopventures.com/team-spintop/' where id = 'f17a95d4-3877-47c0-aaec-1dd5dbeebfcc';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Paolo Gesess (Founder & Managing Partner); Massimiliano Magrini (Founder & Managing Partner); Jacopo Drudi (Partner, Growth); Giulia Giovannini (Partner, Early Stage); Fabio Pirovano (Partner, Growth); Riccardo Coletta (Principal, Growth); Elena Di Maio (Principal, Early Stage); Matteo Moscarelli (Principal, Early Stage); Domenico Di Mola (Venture Partner)'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.85 — source: https://unitedventures.com/team/' where id = '77162301-4e83-4cec-8571-29fb1bd26f14';
update catalog_entities set key_people = coalesce(nullif(key_people, ''), 'Inka Mero; Linda Haapio; Jussi Sainiemi; Pontus Stråhlman; Niko Elers; Harry Santamäki; Kalle Öhman; Jenny Engerfelt; Stina Wallmark'), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Key people imported 2026-07-29 round 2 (prompt 40) — confidence 0.3 — source: https://voimaventures.com/' where id = '8af618a2-ba22-4e84-bbe3-dd375f891a54';
