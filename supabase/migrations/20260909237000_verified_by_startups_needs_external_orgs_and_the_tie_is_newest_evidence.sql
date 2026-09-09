-- Prompt 637 §2 — the label is true by construction — and §3 — the tie is
-- settled by newest evidence, marked TIE-NEWEST-EVIDENCE.
--
-- §2. 635 §2 closed the door on one ACCOUNT counting twice. 637 §1 then
-- measured that the next door cannot be closed by detection: five of the
-- six orgs are Nuno's, on five different e-mail domains (ablute.pt,
-- gmail.com ×2, proton.me, hotmail.com) — no heuristic tells them apart
-- from five strangers. So the rule stops trying to detect independence and
-- only awards the label where independence holds by construction:
--
--   verified_by_startups   n ≥ 3 distinct orgs with is_internal = false
--                          AND n ≥ 3 distinct authors among those orgs
--   plausible_by_startups  n ≥ 2 orgs, internal or not, n ≥ 2 authors
--   verified_by_admin      unchanged — Nuno's own knowledge goes through his
--                          admin account, never through his orgs
--
-- Internal orgs keep contributing and keep reaching plausible, which writes
-- the catalogue and is visible. What they can no longer do is put "3
-- startups agree" on a value when the three startups are ours. is_internal
-- gets a role back: not WHO counts (632 §2.4 took that away, rightly) but
-- HOW FAR they count.
--
-- The argument against, written down so it is not rediscovered: no external
-- org contributes today, so verified_by_startups is unreachable until the
-- first customer does. That is inert by DATA, not by code — the branch is
-- evaluated on every recount and the first external contribution changes
-- the outcome without a deploy. The three inert engines this week were the
-- other kind: code that never ran. And the alternative is live, not
-- hypothetical: three of Nuno's orgs with three accounts would stamp
-- verified_by_startups tomorrow morning, and the label is the product.
--
-- Candidate selection: total support (internal included) stays the FIRST
-- criterion — one external contribution must never outrank two internal
-- orgs' plausible consensus on a different value — and external support is
-- the SECOND, so that between two equally supported values the one that
-- can carry the stronger label is the one chosen.
--
-- §3. TIE-NEWEST-EVIDENCE. Two values with identical support (same
-- least(orgs, authors), same external support, same orgs, same row count)
-- were settled by whatever order the planner happened to produce: the
-- catalogue could change between two recounts with no data changed, which
-- in a product whose promise is "you can trust this value" is the most
-- expensive kind of wrong — not because it errs, but because it is
-- indefensible when someone asks why. Now the value whose most recent
-- contribution is newer wins, and after that the normalised value itself,
-- so the order is total and the outcome reproducible.

create or replace function public.catalog_entity_recount_consensus(p_catalog_id uuid, p_field text)
returns text
language plpgsql security definer set search_path = public as $fn$
declare
  v_best record;
  v_level text;
  v_score int;
  v_consensus_id uuid;
  v_current_score int;
  v_src record;
  v_effective int;
  v_external int;
begin
  if public.catalog_entity_field_column(p_field) is null then return 'ineligible_field'; end if;
  if public.catalog_entity_field_is_admin_only(p_field) then return 'admin_only'; end if;

  select nv, orgs, authors, ext_orgs, ext_authors, rows_n, distinct_sources, sample_value, first_seen, last_seen
    into v_best
    from (
      select x.nv,
             count(distinct x.org_id) as orgs,
             -- Prompt 635 §2: independence is people, not only orgs. Null
             -- authors (AI rows, pre-572 human rows) count for nothing here.
             count(distinct x.author_user_id) as authors,
             -- Prompt 637 §2: the same two counts over EXTERNAL orgs only —
             -- the only support that can carry verified_by_startups.
             count(distinct x.org_id) filter (where not x.internal) as ext_orgs,
             count(distinct x.author_user_id) filter (where not x.internal) as ext_authors,
             count(*) as rows_n,
             -- INVERT-AFTER-631: today only a SHARED url counts as one source;
             -- rows with no source are counted as independent. Once the form
             -- requires a source, change this so that null sources also
             -- collapse to one — see 222000's header.
             count(distinct public.normalize_url(x.source_url)) filter (where x.source_url is not null) as distinct_sources,
             (array_agg(x.value order by x.created_at desc))[1] as sample_value,
             min(x.created_at) as first_seen,
             max(x.created_at) as last_seen
        from (
          select c.org_id, c.author_user_id, c.value, c.created_at, c.source_url,
                 coalesce(o.is_internal, false) as internal,
                 public.catalog_normalize_for_field(c.field, c.value) as nv
            from contributions c
            join entities e on e.id = c.subject_id
            join orgs o on o.id = c.org_id
           where c.subject_type = 'entity' and c.field = p_field
             and c.status in ('submitted', 'verified')
             and coalesce(o.is_test, false) = false
             and coalesce(e.catalog_id,
                          (select d.catalog_id from catalog_deliveries d where d.entity_id = e.id limit 1)) = p_catalog_id
        ) x
       where x.nv is not null
       group by x.nv
       order by least(count(distinct x.org_id), count(distinct x.author_user_id)) desc,
                -- Prompt 637 §2: external support second, never first.
                least(count(distinct x.org_id) filter (where not x.internal),
                      count(distinct x.author_user_id) filter (where not x.internal)) desc,
                count(distinct x.org_id) desc,
                count(*) desc,
                -- TIE-NEWEST-EVIDENCE (Prompt 637 §3): the most recently
                -- contributed value wins an otherwise exact tie, then the
                -- normalised value itself so the order is total.
                max(x.created_at) desc,
                x.nv asc
       limit 1
    ) best;
  if v_best is null then return 'no_values'; end if;

  insert into catalog_field_consensus (catalog_id, field, value, score)
  values (p_catalog_id, p_field, v_best.sample_value, 0)
  on conflict (catalog_id, field) do update set value = excluded.value, updated_at = now()
  returning id, score into v_consensus_id, v_current_score;

  for v_src in
    select distinct on (c.org_id) c.org_id, c.id as contribution_id, c.value
      from contributions c
      join entities e on e.id = c.subject_id
     where c.subject_type = 'entity' and c.field = p_field and c.status in ('submitted', 'verified')
       and coalesce(e.catalog_id, (select d.catalog_id from catalog_deliveries d where d.entity_id = e.id limit 1)) = p_catalog_id
       and public.catalog_normalize_for_field(c.field, c.value) = v_best.nv
     order by c.org_id, c.created_at desc
  loop
    if exists (select 1 from catalog_field_consensus_sources s where s.consensus_id = v_consensus_id and s.org_id = v_src.org_id) then
      update catalog_field_consensus_sources set value = v_src.value, contribution_id = v_src.contribution_id
       where consensus_id = v_consensus_id and org_id = v_src.org_id;
    else
      insert into catalog_field_consensus_sources (consensus_id, org_id, contribution_id, value)
      values (v_consensus_id, v_src.org_id, v_src.contribution_id, v_src.value);
    end if;
  end loop;

  if v_current_score < 0 then return 'rejected_by_review'; end if;

  -- Prompt 635 §2: n orgs AND n people. Prompt 637 §2: the verified label
  -- needs that same n over EXTERNAL orgs; internal support tops out at
  -- plausible.
  v_effective := least(v_best.orgs, v_best.authors);
  v_external := least(v_best.ext_orgs, v_best.ext_authors);
  v_level := case
    when v_external >= 3 and v_best.distinct_sources <> 1 then 'verified_by_startups'
    when v_effective >= 2 then 'plausible_by_startups'
    else null end;
  if v_level is null then
    return case when v_best.orgs >= 2
                then 'pending_orgs_' || v_best.orgs || '_authors_' || v_best.authors || '_external_' || v_external
                else 'pending_1_org' end;
  end if;

  v_score := case v_level when 'verified_by_startups' then 8 else 2 end;
  if v_score > v_current_score then
    update catalog_field_consensus set score = v_score, updated_at = now() where id = v_consensus_id;
  end if;

  if v_level = 'verified_by_startups' then
    update contributions c
       set status = 'verified', reviewed_at = now(),
           reviewer_notes = trim(both ' · ' from coalesce(c.reviewer_notes || ' · ', '') || 'Auto-verified: ' || v_external || ' startups agree.')
      from entities e
     where e.id = c.subject_id and c.subject_type = 'entity' and c.field = p_field and c.status = 'submitted'
       and coalesce(e.catalog_id, (select d.catalog_id from catalog_deliveries d where d.entity_id = e.id limit 1)) = p_catalog_id
       and public.catalog_normalize_for_field(c.field, c.value) = v_best.nv;
  end if;

  perform public.catalog_entity_apply_field(p_catalog_id, p_field, v_best.sample_value, v_level, v_best.first_seen);

  insert into admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
  values (null, 'catalog_entity_consensus', 'catalog_entity', p_catalog_id,
          jsonb_build_object('field', p_field, 'level', v_level, 'org_count', v_best.orgs, 'author_count', v_best.authors,
                             'external_org_count', v_best.ext_orgs, 'external_author_count', v_best.ext_authors,
                             'distinct_sources', v_best.distinct_sources, 'first_seen', v_best.first_seen, 'last_seen', v_best.last_seen,
                             'value', v_best.sample_value));
  return v_level;
end $fn$;

revoke all on function public.catalog_entity_recount_consensus(uuid, text) from public, anon, authenticated;

comment on function public.catalog_entity_recount_consensus(uuid, text) is
  'Prompt 632/635/637 — one consensus engine. plausible: ≥2 orgs and ≥2 authors (internal orgs count); verified_by_startups: ≥3 EXTERNAL orgs and ≥3 authors among them, not all citing one source. Tie: TIE-NEWEST-EVIDENCE. Same-source cap: INVERT-AFTER-631.';
