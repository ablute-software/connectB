-- =============================================================================
-- 0142_backfill_matchdeal_startup_sectors_country.sql
--
-- APPLIED 2026-09-08, on Nuno's decision (Prompt 625 §B), after sitting in
-- this directory unapplied since 6 August. A file in the repo that production
-- never ran is exactly the confusion that produced the 0321 story, so the
-- point of applying it is as much that the ledger and the repo agree as it is
-- the nine rows it fixes.
--
-- (Prompt 620 §A had asked for this file to be deleted along with 0143, on
-- the reading that both had landed in the ledger under other names. 0143 had —
-- and worse, applying it today would have narrowed support_tickets_source_check
-- back, dropping 'blocked' and 'feedback_widget' — so it was deleted. This one
-- had not: its effect was measurably absent from production, which is why it
-- was kept and is now applied instead.)
--
-- AND IT WAS WRONG AS WRITTEN. Two things surfaced only when it was run:
--
--   1. It erased real data. "orgs is canonical" is right for the nine rows
--      where orgs.sectors is populated and the profile's is empty. It is
--      wrong for the tenth: "Sherlock Deal_ test" has NO sectors on the org
--      and TWO on the profile, and the unguarded update would have deleted
--      them. An unfilled orgs.sectors means "nobody has said", not "this
--      company has no sectors" — and a backfill is not the place to resolve
--      that ambiguity by destroying the only value anyone entered.
--
--   2. The erase then broke a NOT NULL: blanking that profile's sectors made
--      matchdeal_profiles.is_complete come back null and the statement failed
--      with 23502. The constraint did its job, and that failure is what
--      exposed (1). Why the completeness recompute returns NULL for an empty
--      profile instead of false is worth a look of its own — flagged, not
--      fixed here, because it belongs to whoever owns that function.
--
-- So the update is GUARDED: it copies orgs -> matchdeal_profiles only where
-- the org actually has something to copy. Nine rows move; the tenth is left
-- alone and named in the report rather than silently skipped.
--
-- The original header is kept below because it explains why orgs is the
-- canonical side at all — and its closing note, that this does NOT normalise
-- the taxonomy, is the thread Prompt 625 §B pulled: 257 of the 629 catalogue
-- entities that declare sectors have an empty or null sectors_normalized, and
-- catalog_match_score reads that column.
-- =============================================================================
-- O PROBLEMA (original)
-- =============================================================================
-- orgs.sectors/country e matchdeal_profiles.sectors/country (kind='startup')
-- ja divergiam em producao antes desta migracao. Nao e so divergencia de
-- conteudo -- e tambem de CASING/taxonomia ("Digital Health" vs "health"),
-- que esta migracao NAO resolve.
--
-- =============================================================================
-- PORQUE orgs E CANONICO
-- =============================================================================
-- migracao 0098 ja criou um trigger de sincronizacao orgs -> matchdeal_profiles
-- (sectors e country), e o proprio comentario dessa migracao ja dizia:
-- "ProfilePanel.tsx's read-only orgs block needs them to reflect the Sherlock
-- Deal settings value once ProfilePanel stops offering a second edit form
-- for them." Ou seja: a intencao SEMPRE foi orgs ser a fonte, e
-- matchdeal_profiles ser o espelho. Esta migracao e so o backfill de dados
-- para as linhas que ja tinham divergido antes dessa correccao -- o trigger
-- 0098 so actua em orgs UPDATEs futuros, nunca retroactivamente.
--
-- matchdeal_eligible_deck() continua a ler matchdeal_profiles.sectors, NUNCA
-- orgs.sectors -- isto nao muda.
-- =============================================================================

begin;

update public.matchdeal_profiles p
set sectors = o.sectors, country = o.country, updated_at = now()
from public.orgs o
where p.membership_id = o.id
  and p.kind = 'startup'
  -- The guard. Never copy an empty orgs.sectors over a populated profile:
  -- "nobody has said" is not "there are none".
  and coalesce(cardinality(o.sectors), 0) > 0
  and (p.sectors is distinct from o.sectors or p.country is distinct from o.country);

commit;
