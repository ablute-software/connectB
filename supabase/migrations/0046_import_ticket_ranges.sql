-- Ticket range import for 71 catalog entities (prompt 39, 2026-07-29).
-- Targeted enrichment: of the 348 catalog_entities that had website + sectors
-- + stage + hq_country but were missing check_min_eur/check_max_eur (the
-- true Layer-1 matching-engine bottleneck — ~9-10% coverage there vs. 75-81%
-- on the other fields, per prompt 34's coverage numbers), the 200 highest-
-- priority rows were researched via public sources only ("never invent" —
-- empty is a valid result). 71 of 200 found (35.5%), 70 imported here.
--
-- FORWARD.one (id 9b2aecf1-e844-4eaf-b80d-3430d3f17f22) is deliberately
-- EXCLUDED — its source currency was never determined, so its EUR value
-- can't be trusted; left null for manual review, not guessed.
--
-- Every UPDATE uses coalesce(existing, new) on both check_min_eur and
-- check_max_eur — this only ever fills a currently-NULL value, never
-- overwrites an existing one. Confirmed live before writing this file: all
-- 70 target rows had check_min_eur/check_max_eur/notes null except three
-- (Gilde Healthcare, Adara Ventures, Level2 Ventures) whose existing
-- check_max_eur already matched the CSV value exactly — coalesce is a no-op
-- for those, not a silent overwrite either way.
--
-- 18 of the 70 were converted from a non-EUR original currency (USD, GBP,
-- SEK, NOK) using fixed approximate rates (USD 0.92, GBP 1.17, SEK 0.088,
-- NOK 0.086 — decision taken by the research agent to unblock the import;
-- these are wide matching ranges, not accounting figures, so an approximate
-- rate is fit for purpose). Every converted row's `notes` records the
-- original currency and amount so this is auditable later, not silently
-- blended in as if it were native-EUR data.
--
-- `notes` is appended (coalesce + conditional newline), never overwritten —
-- defensive even though all 70 rows had null notes today, so this migration
-- stays safe to reason about if that ever changes before it's applied.
--
-- Sanity-checked before writing: no row has check_min_eur > check_max_eur,
-- no negative values, largest max is Ferd at €258M (a PE-scale entity,
-- consistent with its NOK 3bn ticket) — nothing else exceeds €100M.
--
-- Confirm-then-apply, same as 0041-0045: NOT applied by writing this file.

update catalog_entities set check_min_eur = coalesce(check_min_eur, null), check_max_eur = coalesce(check_max_eur, 10000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.75 — source: https://three.vc/' where id = '53787f23-676c-4659-ac17-ad8120bc1a8d';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 13800000), check_max_eur = coalesce(check_max_eur, 27600000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — converted from USD 15000000-30000000 at approx fixed rate — confidence 0.6 — source: https://www.abingworth.com/strategy/' where id = 'db7391b7-be1e-4840-96e9-0d29dcd4f48d';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 500000), check_max_eur = coalesce(check_max_eur, 20000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.85 — source: https://actventure.capital/how-we-work' where id = '08f41d94-c5e1-4563-84e9-b20df55ecf2d';
update catalog_entities set check_min_eur = coalesce(check_min_eur, null), check_max_eur = coalesce(check_max_eur, 3000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.75 — source: https://www.acurio.vc/how-we-invest' where id = 'b2212be6-ccdd-418a-bac2-0c314469eb37';
update catalog_entities set check_min_eur = coalesce(check_min_eur, null), check_max_eur = coalesce(check_max_eur, 2500000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.75 — source: https://www.adara.vc' where id = '479862ac-c920-489c-a556-7d0463318c86';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 88000), check_max_eur = coalesce(check_max_eur, 352000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — converted from SEK 1000000-4000000 at approx fixed rate — confidence 0.8 — source: https://www.almi.se/en/venture-capital/' where id = '08306536-72ee-43f6-afc3-6ccb42af38d2';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 200000), check_max_eur = coalesce(check_max_eur, 3000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.75 — source: https://www.angelwise.be/' where id = '89dcda24-362b-487e-ab92-164cc845e8a6';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 200000), check_max_eur = coalesce(check_max_eur, 3000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.75 — source: https://www.axc.vc/about-us/faq' where id = 'fb8739c3-c6f8-4a27-9dcc-461c5c444965';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 250000), check_max_eur = coalesce(check_max_eur, 5000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.8 — source: https://b2venture.vc' where id = '606ef85b-d71a-4fdc-8a58-9932f3fd0abb';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 200000), check_max_eur = coalesce(check_max_eur, 1750000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.85 — source: https://www.badideas.fund/for-investors' where id = 'a4703121-49a2-4d7e-bff1-7c385f5e72f2';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 1840000), check_max_eur = coalesce(check_max_eur, 9200000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — converted from USD 2000000-10000000 at approx fixed rate — confidence 0.6 — source: https://www.beringea.com/funds-and-services' where id = 'b6e9a385-071e-4606-9137-fe3e9d9993c4';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 3000000), check_max_eur = coalesce(check_max_eur, 30000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.8 — source: https://www.blackfin.com/tech-venture/' where id = 'd27bfa6a-b41e-44d3-bbb0-08ad6dc3f715';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 460000), check_max_eur = coalesce(check_max_eur, 4600000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — converted from USD 500000-5000000 at approx fixed rate — confidence 0.85 — source: https://blueyard.com' where id = 'fc5363c0-c6c2-4cd6-b6bc-abe89805cfd2';
update catalog_entities set check_min_eur = coalesce(check_min_eur, null), check_max_eur = coalesce(check_max_eur, 25000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.75 — source: https://www.bosch.ventures/investment-strategy/' where id = '07457e6f-a05a-4627-9dd2-6912a6ad9073';
update catalog_entities set check_min_eur = coalesce(check_min_eur, null), check_max_eur = coalesce(check_max_eur, 250000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.6 — source: https://buildit.lv/' where id = 'dd6efb69-d861-47f2-8c97-6ed00c541a21';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 500000), check_max_eur = coalesce(check_max_eur, 4000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.9 — source: https://www.byfounders.vc/faq' where id = '189d3699-a8df-48e8-ba66-4b83cfc3f866';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 1000000), check_max_eur = coalesce(check_max_eur, 10000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.6 — source: https://www.capital300.com/' where id = '39021481-d0e6-41b7-b944-e066e27c3581';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 1000000), check_max_eur = coalesce(check_max_eur, 3000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.55 — source: https://capricorn.be/en/channels/capricorn-digital/approach-1' where id = '8b85cc13-d79e-4fa6-a558-fc31bdea1d64';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 690000), check_max_eur = coalesce(check_max_eur, 3680000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — converted from USD 750000-4000000 at approx fixed rate — confidence 0.7 — source: https://www.cardumencapital.com/fund/deeptech' where id = 'b60328e5-e456-4cb6-ad3b-c765e68149a9';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 5000000), check_max_eur = coalesce(check_max_eur, 100000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.6 — source: https://cathayinnovation.com/philosophy/' where id = 'c581ed63-ca2f-4065-967c-7f0395dbd059';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 500000), check_max_eur = coalesce(check_max_eur, 4000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.9 — source: https://cavalry.vc/' where id = 'fe7b8ebc-6a55-408e-8ea6-8db2c3a15e5d';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 585000), check_max_eur = coalesce(check_max_eur, 2340000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — converted from GBP 500000-2000000 at approx fixed rate — confidence 0.9 — source: https://committedcapital.co.uk' where id = '8c23c250-37a0-499e-9cdd-b96724029f37';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 500000), check_max_eur = coalesce(check_max_eur, 8000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.85 — source: https://www.coparion.vc/en' where id = '9f162de5-407e-4687-8949-3964b3586223';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 920000), check_max_eur = coalesce(check_max_eur, 4600000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — converted from USD 1000000-5000000 at approx fixed rate — confidence 0.85 — source: https://www.credoventures.com/' where id = '9d44fff8-3b52-4a5b-8abd-97ef7b13977d';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 100000), check_max_eur = coalesce(check_max_eur, 2000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.85 — source: https://www.deeptechxl.com/investment-strategy' where id = 'ef569530-ed57-4e47-9305-a2a0c7d238f9';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 4600000), check_max_eur = coalesce(check_max_eur, 46000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — converted from USD 5000000-50000000 at approx fixed rate — confidence 0.85 — source: https://www.dtcp.capital/growth' where id = '352b1f73-8875-42d4-810f-df379f6ae701';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 500000), check_max_eur = coalesce(check_max_eur, 5000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.85 — source: https://dutchfoundersfund.com/' where id = 'a2943111-6134-49da-8ed5-9aefe8a64200';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 2000000), check_max_eur = coalesce(check_max_eur, 6000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.8 — source: https://ecapital.vc/about/' where id = '6d4e3d00-7e3a-4940-adea-a040b79d48db';
update catalog_entities set check_min_eur = coalesce(check_min_eur, null), check_max_eur = coalesce(check_max_eur, 10000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.7 — source: https://www.educapitalvc.com' where id = '35b70725-3cfc-4ee0-bcdd-52a30b56cc84';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 1000000), check_max_eur = coalesce(check_max_eur, 3000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.75 — source: https://www.elevator-ventures.com/en/home.html' where id = 'ec87ac2d-00ff-4b58-9955-1d9edc77cb2d';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 300000), check_max_eur = coalesce(check_max_eur, 1000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.8 — source: https://www.11.vc/who-we-are/' where id = '343b16f9-b9a2-4dab-9a61-10206c7561d9';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 5000000), check_max_eur = coalesce(check_max_eur, 20000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.85 — source: https://www.endeit.com/' where id = '2150997b-0698-4c60-83cf-f76404af03e0';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 2000000), check_max_eur = coalesce(check_max_eur, 50000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.8 — source: https://eqtgroup.com/private-capital/eqt-ventures' where id = 'f80ded0d-2128-4584-be59-1c7380ece5ae';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 5000000), check_max_eur = coalesce(check_max_eur, 15000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.85 — source: https://ecbf.vc/about/' where id = 'ffa54939-eb4f-44cc-83fb-74f5c3ae70ea';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 43000000), check_max_eur = coalesce(check_max_eur, 258000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — converted from NOK 500000000-3000000000 at approx fixed rate — confidence 0.6 — source: https://ferd.no/capital/' where id = 'cb666034-b060-4c0b-b160-1c43e1caa652';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 10000), check_max_eur = coalesce(check_max_eur, 2000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.9 — source: https://www.filrougecapital.com/accelerate' where id = 'c3085fc6-6bed-44ef-b8b6-1cf9a85f31c5';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 460000), check_max_eur = coalesce(check_max_eur, 4600000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — converted from USD 500000-5000000 at approx fixed rate — confidence 0.85 — source: https://foundamental.com/' where id = 'febdf4b8-3185-495d-9596-3f3409adf098';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 176000), check_max_eur = coalesce(check_max_eur, 3510000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — converted from GBP 150000-3000000 at approx fixed rate — confidence 0.85 — source: https://fuel.ventures/' where id = 'e04fa359-a1f9-4b4c-8b4d-ba376a639d93';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 200000), check_max_eur = coalesce(check_max_eur, 2000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.75 — source: https://www.gi-de.com/en/ventures' where id = 'de1c7ef4-7c9d-449d-bde4-f10c0a7740fe';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 500000), check_max_eur = coalesce(check_max_eur, 5000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.8 — source: https://gapminder.vc/' where id = '87dc284f-281d-4b96-8843-1cb8ed0ac541';
update catalog_entities set check_min_eur = coalesce(check_min_eur, null), check_max_eur = coalesce(check_max_eur, 50000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.6 — source: https://gildehealthcare.com/venture-growth/' where id = 'b5d97b06-2258-4e87-b3f7-c44c2fa93a4b';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 20000000), check_max_eur = coalesce(check_max_eur, 100000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.7 — source: https://www.gimv.com/en' where id = 'e9ba61da-3bcc-41bc-8578-2a9825f9284e';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 1170000), check_max_eur = coalesce(check_max_eur, 23400000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — converted from GBP 1000000-20000000 at approx fixed rate — confidence 0.85 — source: https://greshamhouseventures.com/' where id = 'cb0bc07a-9290-47ea-bccf-a732211ac2b8';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 100000), check_max_eur = coalesce(check_max_eur, 400000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.9 — source: https://heartfelt.vc/' where id = '094f97ca-61b3-4361-81d9-d88bc68efef9';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 500000), check_max_eur = coalesce(check_max_eur, 60000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.75 — source: https://hvcapital.com/approach/' where id = '0cf2fcaf-4fcd-4bff-914b-243011237ed4';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 150000), check_max_eur = coalesce(check_max_eur, 2000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.7 — source: https://www.inibio.eu/' where id = '2b11be4f-e678-4b9e-9352-8034c80c229d';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 1000000), check_max_eur = coalesce(check_max_eur, 5000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.85 — source: https://www.icoscapital.com/strategy' where id = 'ee9a4102-c1b7-4798-81e2-1d34e06ebeab';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 2000000), check_max_eur = coalesce(check_max_eur, 50000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.65 — source: https://www.innovationindustries.com/about' where id = 'c3033c5b-97a8-4e02-8620-d7b5755589fa';
update catalog_entities set check_min_eur = coalesce(check_min_eur, null), check_max_eur = coalesce(check_max_eur, 36800000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — converted from USD ?-40000000 at approx fixed rate — confidence 0.6 — source: https://www.iqcapital.vc/' where id = '95142c90-cf21-4a0e-8bdd-d07c215ff3bd';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 1000000), check_max_eur = coalesce(check_max_eur, 30000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.9 — source: https://iris.vc/dna' where id = '8652c954-0713-49a2-b6a8-6bf82f8ff962';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 500000), check_max_eur = coalesce(check_max_eur, 5000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.9 — source: https://www.ironwolfcapital.com/' where id = '627f3517-ae96-4d19-8a46-7dfa26c07b9a';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 100000), check_max_eur = coalesce(check_max_eur, 3000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.85 — source: https://www.isai.fr/earlystagevc' where id = '686d691c-ca8e-4f1b-8cda-2fe7fc5663dd';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 2340000), check_max_eur = coalesce(check_max_eur, 5850000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — converted from GBP 2000000-5000000 at approx fixed rate — confidence 0.9 — source: https://iwcapital.co.uk/seek-funding/' where id = '5a971ae2-6b39-4d2e-a8da-fe1f9da46541';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 880000), check_max_eur = coalesce(check_max_eur, 44000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — converted from SEK 10000000-500000000 at approx fixed rate — confidence 0.85 — source: https://jce.se' where id = 'aa4507a3-0053-4353-a143-e9ca447cac83';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 1000000), check_max_eur = coalesce(check_max_eur, 5000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.9 — source: https://www.join.capital/approach/' where id = '569ad186-f51f-4d26-9751-be8147242d69';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 10000000), check_max_eur = coalesce(check_max_eur, 50000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.75 — source: https://www.jolt-capital.com/about-us' where id = '1d335cf8-51ad-472f-89ce-9c4a58d9d9b9';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 100000), check_max_eur = coalesce(check_max_eur, 10000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.85 — source: https://www.kfund.vc/' where id = '26a49baf-7ae2-491c-9285-89a0f0b5c832';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 100000), check_max_eur = coalesce(check_max_eur, 3000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.95 — source: https://www.kaya.vc/ethos' where id = '1dfe7d13-7ebf-4985-8957-e33e5219bf08';
update catalog_entities set check_min_eur = coalesce(check_min_eur, null), check_max_eur = coalesce(check_max_eur, 3000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.55 — source: https://launchub.com/' where id = 'ad2d72f2-0a9b-4c07-a6dd-65267d70291e';
update catalog_entities set check_min_eur = coalesce(check_min_eur, null), check_max_eur = coalesce(check_max_eur, 5000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.7 — source: https://level2.vc/' where id = '60531f55-f888-4496-bbb5-acb9599acc70';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 500000), check_max_eur = coalesce(check_max_eur, 2000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.7 — source: https://www.lunar.vc/about' where id = '3b1bd9b9-45cb-474d-9fe8-863b65b7bef1';
update catalog_entities set check_min_eur = coalesce(check_min_eur, null), check_max_eur = coalesce(check_max_eur, 11700000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — converted from GBP ?-10000000 at approx fixed rate — confidence 0.8 — source: https://www.merciaventures.co.uk/' where id = '2427d041-76dd-476f-88aa-df550b6a8d5d';
update catalog_entities set check_min_eur = coalesce(check_min_eur, null), check_max_eur = coalesce(check_max_eur, 11700000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — converted from GBP ?-10000000 at approx fixed rate — confidence 0.85 — source: https://mmc.vc/about-us/' where id = '49d9fd7c-8cff-41f3-bb2c-efaefb75a45e';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 1000000), check_max_eur = coalesce(check_max_eur, 5000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.9 — source: https://www.nautacapital.com/' where id = '521d2b65-e572-4c89-aad1-9cab7b3cff3d';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 230000), check_max_eur = coalesce(check_max_eur, 1840000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — converted from USD 250000-2000000 at approx fixed rate — confidence 0.9 — source: https://newfundcap.com/philosophy' where id = 'a6cfbf3f-4fb3-474a-8f18-ec263ec61ae9';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 2000000), check_max_eur = coalesce(check_max_eur, 8000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.9 — source: https://nordicninja.com/fund/' where id = '75c64348-beab-4b26-8dd6-cbb2f157ae2d';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 1000000), check_max_eur = coalesce(check_max_eur, 10000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.75 — source: https://www.norrsken.vc/' where id = 'bca85af7-83a9-457e-bff3-374e56a6e33a';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 1000000), check_max_eur = coalesce(check_max_eur, 8000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.75 — source: https://www.notioncapital.com/resources/fund4' where id = 'c13b6517-af8a-4fc4-b759-0103507e8f41';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 2000000), check_max_eur = coalesce(check_max_eur, 6000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.85 — source: https://www.openocean.vc/philosophy' where id = '1ca0f765-aeaf-42e7-956c-ea6e37f7d52c';
update catalog_entities set check_min_eur = coalesce(check_min_eur, 1000000), check_max_eur = coalesce(check_max_eur, 7000000), notes = coalesce(notes, '') || case when notes is not null and notes <> '' then E'
' else '' end || 'Ticket range imported 2026-07-29 (prompt 39) — confidence 0.8 — source: https://otb.vc/about/' where id = '8f3d1a35-f919-40a6-b2bf-0852870ce7bc';
