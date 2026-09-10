-- Prompt 642 §5 — BuenaVista Equity: the eight "+ Add info" items and the
-- dossier row, placed at verified_by_admin, author nunomarujo@ablute.pt.
--
-- The eight contributions were written on 2026-09-09 by the developer
-- account through a form whose field was free text ("Thesis ", "LInkedin ",
-- "Portugal", "investor", "Recepcionist", "portuguese site", a 70-character
-- sentence), so catalog_entity_field_column() returned null for all of
-- them and the consensus called them ineligible before counting anything.
-- The dossier edit of 18:40 (website, e-mail, phone, address, six sectors,
-- Iberia, seed→series_a) generated no contribution at all. The catalogue
-- row stayed empty: 0 fields, 0 people.
--
-- This migration is the placement 642 §5's table describes, applied
-- through catalog_entity_apply_field at verified_by_admin (the ladder and
-- the stamp, not a bare UPDATE). A migration has no auth.uid(), so the
-- §2.1/§3.3 admin branches cannot fire here; the rows are written the way
-- those branches would write them and every audit row names the account.
-- The eight ledger rows stay — they become 'verified', each with a note
-- saying where its value went. Nothing is deleted.
--
-- §6 defaults, where an answer is still pending: e-mail
-- lisbon@buenavistaequity.pt (the contribution; the dossier says
-- hello@buenavista.pt — §6.1), website .com (the dossier; the .pt site is
-- the source of the thesis and address — §6.1), the two board members with
-- the title Nuno wrote, "Investor / Board" (rank 3 — §6.2).

do $$
declare
  v_cat   constant uuid := '9ecdd576-3e08-42de-8bbc-034e5ff26d13';  -- catalog_entities: BuenaVista Equity
  v_ent   constant uuid := 'dd2ec1a4-40ea-4507-b168-6eec694489b4';  -- entities (ablute_ dossier)
  v_admin constant uuid := 'c934d05b-1838-46fc-8c75-d2a454f3aa38';  -- nunomarujo@ablute.pt
  v_iberis constant uuid := 'ac476256-fc1d-4976-ab23-2e8ddc412f22';
  v_pt_site constant text := 'https://buenavistaequity.pt/#ethos';
  v_hope_url constant text := 'https://eco.sapo.pt/2026/09/08/iberis-capital-lidera-ronda-de-seis-milhoes-de-euros-na-startup-de-saude-hope-care/';
  v_hope_text constant text := 'Hope Care (Set 2026) — ronda de €6M liderada pela Iberis Capital, com Buenavista Equity e VDM Capital';
  v_thesis text;
  v_hope_note text;
  v_fields text[] := '{}';
  v_person uuid;
  v_n int := 0;
  r record;
begin
  if not exists (select 1 from public.catalog_entities where id = v_cat and name = 'BuenaVista Equity') then
    raise exception 'BuenaVista Equity catalogue row not found';
  end if;

  select note into v_thesis from public.contributions where id::text like 'c501c56e%' and subject_id = v_ent;
  select note into v_hope_note from public.contributions where id::text like '73784479%' and subject_id = v_ent;

  -- ---- entity fields, through the ladder at verified_by_admin
  for r in
    select * from (values
      ('thesis',                 to_jsonb(v_thesis)),
      ('current_funds',          to_jsonb('Buenavista Tech Seed'::text)),
      ('linkedin_url',           to_jsonb('https://www.linkedin.com/company/buenavista-equity-partners/'::text)),
      ('website',                to_jsonb('https://www.buenavistaequity.com/'::text)),
      ('address',                to_jsonb('Av. 5 de Outubro, 16 – 4º Esquerdo'::text)),
      ('postal_code',            to_jsonb('1050-055'::text)),
      ('hq_city',                to_jsonb('Lisboa'::text)),
      ('hq_country',             to_jsonb('PT'::text)),
      ('phone',                  to_jsonb('+351 215 880 009'::text)),
      ('email',                  to_jsonb('lisbon@buenavistaequity.pt'::text)),
      ('sectors',                to_jsonb(array['health','digital health','biotech','medtech','life sciences','wellness'])),
      ('geographies',            to_jsonb(array['Iberia'])),
      ('stage_min',              to_jsonb('seed'::text)),
      ('stage_max',              to_jsonb('series_a'::text)),
      ('last_investment_found',  to_jsonb(v_hope_text)),
      ('key_people',             to_jsonb('Francisco Lino Marques (Investor / Board); Bibi Sattar Marques (Investor / Board)'::text))
    ) as t(field, value)
  loop
    if r.value is not null and jsonb_typeof(r.value) <> 'null' then
      if public.catalog_entity_apply_field(v_cat, r.field, r.value, 'verified_by_admin', now()) then
        v_fields := array_append(v_fields, r.field); v_n := v_n + 1;
      end if;
    end if;
  end loop;

  update public.catalog_entities
     set verified_by = coalesce(verified_by, v_admin), verified_at = coalesce(verified_at, now()),
         notes = concat_ws(E'\n', nullif(notes, ''),
                   'portuguese site (thesis, address): ' || v_pt_site,
                   case when v_hope_note is not null then 'Hope Care (Set 2026): ' || v_hope_note end)
   where id = v_cat;

  -- ---- the ledger: the eight rows become verified, each saying where it went
  update public.contributions set status = 'verified', reviewed_by = v_admin, reviewed_at = now(),
         source_url = coalesce(source_url, v_pt_site),
         reviewer_notes = 'Prompt 642 §5 — colocado em thesis e current_funds (Buenavista Tech Seed)'
   where id::text like 'c501c56e%' and subject_id = v_ent;
  update public.contributions set status = 'verified', reviewed_by = v_admin, reviewed_at = now(),
         reviewer_notes = 'Prompt 642 §5 — colocado em linkedin_url (normalizado, sem /about/)'
   where id::text like '5f8a6c9c%' and subject_id = v_ent;
  update public.contributions set status = 'verified', reviewed_by = v_admin, reviewed_at = now(),
         source_url = coalesce(source_url, v_pt_site),
         reviewer_notes = 'Prompt 642 §5 — colocado em address, postal_code, hq_city, hq_country, phone, email (§6.1: hello@buenavista.pt no dossier)'
   where id::text like '0b2caf3e%' and subject_id = v_ent;
  update public.contributions set status = 'verified', reviewed_by = v_admin, reviewed_at = now(),
         reviewer_notes = 'Prompt 642 §5 — pessoa criada: Bibi Sattar Marques, Investor / Board (§6.2)'
   where id::text like 'acd54ba5%' and subject_id = v_ent;
  update public.contributions set status = 'verified', reviewed_by = v_admin, reviewed_at = now(),
         reviewer_notes = 'Prompt 642 §5 — pessoa criada: Francisco Lino Marques, Investor / Board (§6.2)'
   where id::text like 'ca5a1e7c%' and subject_id = v_ent;
  update public.contributions set status = 'verified', reviewed_by = v_admin, reviewed_at = now(),
         reviewer_notes = 'Prompt 642 §5 — pessoa criada: Catarina Morgado, Receptionist (rank 9; canal, não decisora)'
   where id::text like '965099d2%' and subject_id = v_ent;
  update public.contributions set status = 'verified', reviewed_by = v_admin, reviewed_at = now(),
         reviewer_notes = 'Prompt 642 §5 — source_url das linhas thesis/address e notes; website fica o .com do dossier (§6.1)'
   where id::text like '6c5a6f1f%' and subject_id = v_ent;
  update public.contributions set status = 'verified', reviewed_by = v_admin, reviewed_at = now(),
         source_url = coalesce(source_url, v_hope_url),
         reviewer_notes = 'Prompt 642 §5 — colocado em last_investment_found (BuenaVista e Iberis Capital); descrição em notes'
   where id::text like '73784479%' and subject_id = v_ent;

  -- ---- the three people, the way contribute_catalog_person's admin branch writes them
  for r in
    select * from (values
      ('Bibi Sattar Marques',   'Investor / Board', 'board_member'::affiliation_kind),
      ('Francisco Lino Marques', 'Investor / Board', 'board_member'::affiliation_kind),
      ('Catarina Morgado',      'Receptionist',     'other'::affiliation_kind)
    ) as t(full_name, title, kind)
  loop
    select cp.id into v_person from public.catalog_people cp
      join public.catalog_person_affiliations a on a.person_id = cp.id and a.entity_id = v_cat
     where public.normalize_person_name(cp.full_name) = public.normalize_person_name(r.full_name) limit 1;
    if v_person is null then
      insert into public.catalog_people (full_name, entity_id, hook_status, enrichment_status, source_kind, source_confidence, source_recorded_at, source_url)
      values (r.full_name, v_cat, 'to_research', 'pending', 'manual', 'recorded', now(), v_pt_site)
      returning id into v_person;
    end if;
    insert into public.catalog_person_affiliations (person_id, entity_id, title, kind, current, is_primary, seniority_rank)
    values (v_person, v_cat, r.title, r.kind, true,
            not exists (select 1 from public.catalog_person_affiliations x where x.person_id = v_person and x.is_primary),
            public.catalog_seniority_rank_from_title(r.title))
    on conflict (person_id, entity_id, kind) do update
      set title = excluded.title, seniority_rank = excluded.seniority_rank, current = true;
    insert into public.catalog_people_research (person_id, verified_fields) values (v_person, jsonb_build_object('role', 'verified_by_admin'))
    on conflict (person_id) do update set verified_fields = public.catalog_people_research.verified_fields || jsonb_build_object('role', 'verified_by_admin'), updated_at = now();
    if not exists (select 1 from public.catalog_entity_enrichment_sources s where s.entity_id = v_cat and s.person_id = v_person and s.source_type = 'admin_contribution') then
      insert into public.catalog_entity_enrichment_sources (entity_id, person_id, source_url, source_type, verified_at, supports, quality, notes, batch_id, contributed_by_user_id)
      values (v_cat, v_person, 'admin:' || v_admin::text, 'admin_contribution', current_date, 'person_affiliation', 'developer_recorded',
              'Developer contribution (Prompt 642 §5) — sem fonte, por decisão do developer; nome escrito no "+ Add info" de 2026-09-09', 'admin_contribution:prompt642', v_admin);
    end if;
    insert into public.admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
    values (v_admin, 'catalog_person_admin_created', 'catalog_person', v_person,
            jsonb_build_object('entity_id', v_cat, 'title', r.title, 'kind', r.kind::text, 'prompt', '642 §5'));
  end loop;

  -- ---- Iberis Capital led the same round
  if exists (select 1 from public.catalog_entities where id = v_iberis) then
    if public.catalog_entity_apply_field(v_iberis, 'last_investment_found', to_jsonb(v_hope_text), 'verified_by_admin', now()) then
      v_fields := array_append(v_fields, 'iberis:last_investment_found');
    end if;
    if not exists (select 1 from public.catalog_entity_enrichment_sources s where s.entity_id = v_iberis and s.person_id is null and s.source_url = v_hope_url) then
      insert into public.catalog_entity_enrichment_sources (entity_id, source_url, source_type, verified_at, supports, quality, notes, batch_id, contributed_by_user_id)
      values (v_iberis, v_hope_url, 'admin_contribution', current_date, 'last_investment_found', 'developer_recorded', 'Prompt 642 §5 — Hope Care, ronda de €6M liderada pela Iberis Capital', 'admin_contribution:prompt642', v_admin);
    end if;
  end if;
  if not exists (select 1 from public.catalog_entity_enrichment_sources s where s.entity_id = v_cat and s.person_id is null and s.source_url = v_hope_url) then
    insert into public.catalog_entity_enrichment_sources (entity_id, source_url, source_type, verified_at, supports, quality, notes, batch_id, contributed_by_user_id)
    values (v_cat, v_hope_url, 'admin_contribution', current_date, 'last_investment_found', 'developer_recorded', 'Prompt 642 §5 — Hope Care, ronda de €6M', 'admin_contribution:prompt642', v_admin);
  end if;
  if not exists (select 1 from public.catalog_entity_enrichment_sources s where s.entity_id = v_cat and s.person_id is null and s.source_url = v_pt_site) then
    insert into public.catalog_entity_enrichment_sources (entity_id, source_url, source_type, verified_at, supports, quality, notes, batch_id, contributed_by_user_id)
    values (v_cat, v_pt_site, 'admin_contribution', current_date, 'thesis', 'developer_recorded', 'Prompt 642 §5 — site .pt: tese e morada', 'admin_contribution:prompt642', v_admin);
  end if;

  insert into public.admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
  values (v_admin, 'catalog_entity_admin_write', 'catalog_entity', v_cat,
          jsonb_build_object('prompt', '642 §5', 'fields', to_jsonb(v_fields), 'people', 3, 'pending_decisions', jsonb_build_array('§6.1 email/website', '§6.2 titles')));
  raise notice 'BuenaVista: % fields applied (%), 3 people', v_n, array_to_string(v_fields, ', ');
end $$;
