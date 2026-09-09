-- Prompt 633 §2.3.a/b — the seniority classifier did not know the word CEO.
--
-- Measured: 1 450 affiliations with no rank; 1 061 of them HAVE a title. The
-- titles it could not read are the most senior ones in the catalogue —
-- Managing Director ×36, Investor ×34, CEO ×17 + Chief Executive Officer ×9,
-- Chairman ×9, Founder ×7 — plus everything not in English (Geschäftsführer,
-- Investeringsdirektør, Bestuurder, Beteiligungsmanager, Investeerder). The
-- old list had `cfo` and `coo` and not `ceo`; rank 1 required "managing
-- PARTNER"; "Founder" alone matched nothing. Meanwhile Analysts ranked 4 and
-- passed the enrichment band, and the CEOs did not.
--
-- ORDER IS THE WHOLE DESIGN — first match wins — and three dry runs over the
-- real 1 450 titles shaped it:
--   · "Non Executive Director" contains "executive director" (rank 2), so
--     the non-executive / independent / investor-relations pre-empts come
--     first. Investor relations is a 9 whatever it is attached to, per the
--     prompt: "Partner, Investor Relations" is an IR partner.
--   · "Vice President" contains "president" (rank 1); "Founder's Associate"
--     contains "founder" (rank 1). Both are pre-empted to 3.
--   · "General Partner & Chief of Staff" must stay 1, so chief of staff is
--     NOT a pre-empt — it sits in the rank-9 list after the senior patterns.
--     The v2 dry run had it as a pre-empt and demoted a General Partner.
--   · "Founding partner & Chairman of the Election Committee" must stay 1,
--     so chairman is likewise in the late rank-9 list, not up front.
--
-- Dry run of THIS version against production: 620 of the 1 061 leave null
-- (169 → 1, 37 → 2, 146 → 3, 268 → 9), inside the prompt's 600–700
-- estimate. 36 already-ranked rows would rank differently under it, almost
-- all upward ("Founder & Partner" 2 → 1, "Board Director and Founder"
-- 9 → 1); those are NOT touched here — only null rows are backfilled, per
-- §2.3.b — and are listed in the report for a decision.
--
-- Left null on purpose, as the prompt asked: Investment Committee / IC /
-- Investment Committee Member (opinion in the report), and the bare
-- Member / Manager / Director, which are ambiguous. §2.3.c (next file)
-- means null no longer excludes them from the queue; it puts them last.

create or replace function public.catalog_seniority_rank_from_title(p_title text)
returns int
language sql
immutable
set search_path = public
as $$
  select case
    when p_title is null or btrim(p_title) = '' then null
    -- Pre-empts: contain senior words but are not investment decision-makers.
    when p_title ~* 'non[\s-]?executive|independent\s+director|investor\s+relations' then 9
    -- Pre-empts: contain rank-1 words but are junior or advisory.
    when p_title ~* 'vice[\s-]?president|venture\s+partner|founder''?s\s+(associate|office)' then 3
    -- 1 — the firm's own top decision-makers.
    when p_title ~* '(founding|managing|general)\s+partner' then 1
    when p_title ~* '\yceo\y|chief\s+executive|managing\s+director|\yfounder\y|founding|\ypresident\y|gesch(ä|a)ftsf(ü|u)hrer|bestuurder' then 1
    -- 2 — Partner, Principal, Investment/Executive/Portfolio Director, CIO.
    when p_title ~* 'chief\s+investment|investment\s+director|investeringsdirekt|executive\s+director|portfolio\s+director|beteiligungsmanager' then 2
    when p_title ~* 'partner|principal' then 2
    -- 3 — the investment team below partner.
    when p_title ~* 'investment\s+manager|associate' then 3
    when p_title ~* 'investment\s+team|\yinvestments\y|\yinvestor\y|investeerder|investment\s+(professional|executive)|portfolio\s+manager|fund\s+manager' then 3
    -- 4 — Analyst.
    when p_title ~* '\yanalyst\y' then 4
    -- 9 — never worth a hook-research call.
    when p_title ~* '\ychair(man|woman|person)?\y|chief\s+of\s+staff|cfo|coo|chief\s+(financial|operating)|legal|compliance|general counsel|\yit\y|information technology|marketing|platform|office manager|executive assistant|\yassistant\y|board|supervisory|\yadvisor\y' then 9
    when p_title ~* '\yfinance\y|financial|controller|accountant|communications|business\s+development|\yoperations\y|client\s+services' then 9
    -- Unmapped: Member, Manager, Director, Investment Committee, committee
    -- names. Left null rather than guessed; surfaced by the report query.
    else null
  end;
$$;

-- §2.3.b — backfill the nulls only. Rows that already carry a rank keep it.
update public.catalog_person_affiliations
   set seniority_rank = public.catalog_seniority_rank_from_title(title)
 where seniority_rank is null
   and title is not null and btrim(title) <> ''
   and public.catalog_seniority_rank_from_title(title) is not null;
