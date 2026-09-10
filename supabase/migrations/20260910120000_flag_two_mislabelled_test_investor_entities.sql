-- Prompt 880 §1 — two investor fixtures were mislabelled is_test = false.
--
-- investor_pipeline_admissions (the table behind the "N investor firms have
-- you in their pipeline" banner) has 12 rows in the whole database, resolving
-- to four investor entities — every one a test/QA/personal fixture. Two of
-- them, "Test investor" and "Test idividual" (a typo in its own name), carried
-- is_test = false, so even with the banner's new is_test = false filter
-- (this prompt's code half) they would still have leaked a fake count to real
-- founders (Estojo, Krohnsty). They are unmistakable fixtures: the names say
-- so, and both have no website, no email and no people. Flag them so the
-- filter catches them.
--
-- Guarded so it only ever touches those specific mislabelled fixtures and is
-- a no-op on replay: name match AND is_test still false AND no website/email
-- (a real investor named this way would have at least one). Nothing else in
-- the catalogue is affected.
update public.catalog_entities
   set is_test = true
 where name in ('Test investor', 'Test idividual')
   and is_test = false
   and website is null
   and email is null;
