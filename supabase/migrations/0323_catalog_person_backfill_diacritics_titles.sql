-- Prompt 581 §D.1 follow-up — the first backfill pass (migration 0320)
-- linked 458 of 1782 people. Spot-checking the unmatched ones (still
-- name-mismatched even though their entity's catalog affiliations
-- clearly included the same person) showed two safe, common patterns:
-- diacritics ("Jose Cil" vs "José Cil", "Celia Favennec" vs
-- "Célia Favennec") and honorific prefixes ("Dr Mark Payton" vs
-- "Mark Payton", "Jos B. Peeters" vs "Dr. Jos B. Peeters"). Both are the
-- same normalized name for the same real person, not a coincidence.
--
-- normalize(text, NFD) + stripping the Unicode combining-marks range is
-- Postgres's built-in equivalent of catalog-dedupe.ts's own
-- normalizeName (.normalize('NFD').replace(/\p{Diacritic}/gu, '')) — same
-- approach, no new extension (unaccent isn't installed on this project;
-- Postgres's built-in normalize() needs nothing extra). Title-prefix
-- stripping is new here (catalog-dedupe.ts doesn't need it — firm names
-- don't carry "Dr."), scoped to the handful of unambiguous honorifics
-- that could never themselves be someone's first name.
--
-- Deliberately NOT chasing further: genuine spelling variants
-- ("Mittelmeier" vs "Mittelmeijer") stay unlinked. Fuzzy/typo-tolerant
-- matching risks linking two different people who happen to have similar
-- names — the prompt's own instruction is that a non-match "fica null...
-- o operador liga à mão", and that's the right failure mode here.
with candidates as (
  select
    p.id as person_id,
    cpa.person_id as catalog_person_id,
    row_number() over (
      partition by p.id
      order by cpa.is_primary desc, cpa.current desc
    ) as rn
  from public.people p
  join public.entities e on e.id = p.entity_id and e.catalog_id is not null
  join public.catalog_person_affiliations cpa on cpa.entity_id = e.catalog_id
  join public.catalog_people cp on cp.id = cpa.person_id
  where p.catalog_person_id is null
    and regexp_replace(
          lower(regexp_replace(normalize(btrim(p.full_name), nfd), '[̀-ͯ]', '', 'g')),
          '^(dr|mr|mrs|ms|prof)\.?\s+', '', 'i'
        )
      = regexp_replace(
          lower(regexp_replace(normalize(btrim(cp.full_name), nfd), '[̀-ͯ]', '', 'g')),
          '^(dr|mr|mrs|ms|prof)\.?\s+', '', 'i'
        )
)
update public.people p
set catalog_person_id = c.catalog_person_id
from candidates c
where c.person_id = p.id and c.rn = 1;
