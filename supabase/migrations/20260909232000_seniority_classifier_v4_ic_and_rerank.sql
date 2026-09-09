-- Prompt 636 §2.1–§2.3 — the three decisions on the classifier, applied.
--
-- §2.1  Investment Committee / Investment Committee Member / IC / AC member
--       → rank 3. At a fund with ranked partners the band rule keeps the
--       sweep on the partner; where nobody else is ranked the IC passes.
--       Rank 1–2 would have put external IC members ahead of the firm's own
--       partners, which was the risk 633 raised.
-- §2.2  Head of Venture Capital → 2 (the partner-equivalent at a bank or a
--       corporate); Impact Manager → 3.
-- §2.3  The already-ranked rows the widened classifier ranks differently
--       ARE re-ranked now — "Founder & Partner" 2→1, "Board Director and
--       Founder" 9→1, "CEO & Partner" 2→1 were wrong and are right after —
--       with one exception, by name: the two Investor-Relations PARTNERS
--       (Anna Slemmings, MMC Ventures; Johan van Dijk, ECFG Venture
--       Capital) stay at 2. "Partner" and "Investor Relations" in one title
--       is ambiguous, and a rule should not cost two partners.
--
-- Dry run against production before applying: 28 null rows gain a rank
-- under the new clauses; 38 already-ranked rows would change, 36 after the
-- two exceptions. Rows whose new rank would be NULL are never demoted.

create or replace function public.catalog_seniority_rank_from_title(p_title text)
returns int
language sql
immutable
set search_path = public
as $$
  select case
    when p_title is null or btrim(p_title) = '' then null
    when p_title ~* 'non[\s-]?executive|independent\s+director|investor\s+relations' then 9
    when p_title ~* 'vice[\s-]?president|venture\s+partner|founder''?s\s+(associate|office)' then 3
    when p_title ~* '(founding|managing|general)\s+partner' then 1
    when p_title ~* '\yceo\y|chief\s+executive|managing\s+director|\yfounder\y|founding|\ypresident\y|gesch(ä|a)ftsf(ü|u)hrer|bestuurder' then 1
    when p_title ~* 'chief\s+investment|investment\s+director|investeringsdirekt|executive\s+director|portfolio\s+director|beteiligungsmanager|head\s+of\s+venture\s+capital' then 2
    when p_title ~* 'partner|principal' then 2
    when p_title ~* 'investment\s+manager|associate' then 3
    when p_title ~* 'investment\s+team|\yinvestments\y|\yinvestor\y|investeerder|investment\s+(professional|executive)|portfolio\s+manager|fund\s+manager|investment\s+committee|\yic\y|\yac\s+member|impact\s+manager' then 3
    when p_title ~* '\yanalyst\y' then 4
    when p_title ~* '\ychair(man|woman|person)?\y|chief\s+of\s+staff|cfo|coo|chief\s+(financial|operating)|legal|compliance|general counsel|\yit\y|information technology|marketing|platform|office manager|executive assistant|\yassistant\y|board|supervisory|\yadvisor\y' then 9
    when p_title ~* '\yfinance\y|financial|controller|accountant|communications|business\s+development|\yoperations\y|client\s+services' then 9
    else null
  end;
$$;

-- Nulls that now resolve (§2.1/§2.2).
update public.catalog_person_affiliations
   set seniority_rank = public.catalog_seniority_rank_from_title(title)
 where seniority_rank is null
   and title is not null and btrim(title) <> ''
   and public.catalog_seniority_rank_from_title(title) is not null;

-- §2.3 — re-rank the already-ranked, except the two IR partners; never to null.
update public.catalog_person_affiliations a
   set seniority_rank = public.catalog_seniority_rank_from_title(a.title)
 where a.seniority_rank is not null
   and a.title is not null
   and public.catalog_seniority_rank_from_title(a.title) is not null
   and public.catalog_seniority_rank_from_title(a.title) is distinct from a.seniority_rank
   and not (a.seniority_rank = 2 and public.catalog_seniority_rank_from_title(a.title) = 9 and a.title ~* 'investor\s+relations');
