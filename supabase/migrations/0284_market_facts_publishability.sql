-- Prompt 491 — the SECOND link of North Star §3, invariable 6: "Uma
-- conclusão publicada nunca pode depender exclusivamente de evidência que a
-- audiência não está autorizada a ver. As permissões propagam:
-- evidence.visibility -> fact.publishability -> derivation.publishability
-- -> artifact.eligibility."
--
-- Only the first link existed (market_evidence.visibility, migration 0279),
-- and it is inert: nothing in src/ ever writes it a value other than the
-- default and nothing reads it. This migration builds the second link and
-- the code beside it writes the value on every fact write, so this one does
-- NOT arrive inert. Links 3 and 4 are deliberately absent — there are no
-- derivations and no published artifact reading market_facts yet, and
-- building a permission for a consumer that does not exist is how the first
-- link ended up decorative.
--
-- WHY A TWO-VALUE VOCABULARY AND NOT visibility'S THREE. Reusing
-- ('private','publishable','published') would put a value in this column
-- that the derivation can NEVER emit: 'published' is a state of the world
-- (someone published it), not something computable from the evidence
-- behind a fact — that is link 4's business. Prompt 467 v3 §5 removed
-- 'conflicting' from verification_status for exactly this reason: "leaving
-- it in the type ahead of a real cross-fact comparison existing would
-- invite writing it by hand — exactly what 'derived, not hand-written'
-- forbids." Same rule, same decision. This column answers one question —
-- may this fact be shown to an audience that is not the founder — and it
-- has exactly the two answers that question has.
--
-- Structural note (AUTONOMOUS_EXECUTION_MODE_v2 §12, as widened 30/08):
--   - the column is nullable, with no default, and no not-null;
--   - ZERO backfill. Existing rows keep NULL, which reads as "the
--     derivation never ran on this row" — strictly more honest than
--     stamping them 'not_publishable', which would claim a computation
--     that never happened. They pick up a real value the next time
--     writeMarketFact touches them. Nothing reads this column yet, so NULL
--     costs nothing today; when a reader is eventually built it must treat
--     NULL as not publishable (fail closed), and that belongs in the
--     prompt that builds the reader, not here.
--   - the CHECK admits NULL explicitly, same shape as migration 0280's
--     founder_prompt_state.
--
-- Rollback: `alter table market_facts drop column publishability;` plus
-- `drop function public.write_market_fact(uuid, text, text, jsonb, text,
-- jsonb, text, jsonb, text);`. Safe at any point before the application
-- code that passes the 9th argument is deployed — and safe after it too,
-- as long as both are reverted together.
alter table market_facts
  add column if not exists publishability text
    check (publishability is null or publishability in ('publishable', 'not_publishable'));

comment on column market_facts.publishability is
  'Prompt 491 — invariable 6, second link. DERIVED (market-facts-db.ts derivePublishability), never hand-written, recomputed on every writeMarketFact from the visibility of the evidence behind the fact. NULL means the derivation never ran on this row (pre-491), not "publishable" — any future reader must treat NULL as not publishable.';

-- The 9-argument overload. It does NOT duplicate migration 0279's body: it
-- calls the 8-argument function to do all the work and then stamps the
-- derived value, inside ONE function invocation and therefore inside ONE
-- transaction — so "writeMarketFact makes exactly one mutating call" stays
-- literally true, which is what keeps "no market_fact left orphaned by a
-- partial write" true from the application's side.
--
-- WHY AN OVERLOAD RATHER THAN REPLACING THE 8-ARGUMENT FUNCTION. Replacing
-- it in place is impossible (a different argument list is a different
-- function in Postgres) and dropping it would break the code that is live
-- in production during the window between this migration being applied and
-- the new deploy landing — a self-inflicted outage on the document
-- extraction path, for tidiness. The 8-argument function is therefore left
-- exactly as it is, still valid, still the implementation. Retiring it once
-- nothing calls it needs `drop function`, which is outside the additive
-- boundary, so it needs its own sign-off — not a side effect of this one.
--
-- p_publishability deliberately has NO DEFAULT. With a default, a call
-- carrying the old 8 named arguments would match BOTH functions and
-- Postgres could not choose between them; without one, the two argument
-- sets are disjoint and each call resolves to exactly one function.
-- Verified empirically against this database (31/08) with a throwaway pair
-- of overloads of the same shape: the 2-arg named call resolved to the
-- 2-arg function and the 3-arg named call to the 3-arg one, no ambiguity
-- error in either direction.
--
-- Applied and verified against production 31/08, before this file was
-- committed: the column is nullable with no default; the CHECK admits NULL;
-- BOTH overloads exist and BOTH have EXECUTE for postgres/service_role only
-- (public/anon/authenticated revoked — checked on the ACL, not on the
-- revoke statement having been written); all 67 pre-existing facts still
-- read NULL, zero backfill. The wrapper itself was proven end to end inside
-- a DO block whose only exit is a RAISE — it wrote a fact, read back
-- publishability = 'publishable' and one observation row, and rolled the
-- whole thing back; the follow-up count confirmed 67 facts and 43 evidence
-- rows unchanged, with no zz-test remnant.
create or replace function public.write_market_fact(
  p_org_id uuid,
  p_fact_type text,
  p_fact_fingerprint text,
  p_payload jsonb,
  p_validation_status text,
  p_validation jsonb,
  p_verification_status text,
  p_observations jsonb,
  p_publishability text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_fact_id uuid;
begin
  v_fact_id := public.write_market_fact(
    p_org_id, p_fact_type, p_fact_fingerprint, p_payload,
    p_validation_status, p_validation, p_verification_status, p_observations
  );

  update public.market_facts
    set publishability = p_publishability
    where id = v_fact_id;

  return v_fact_id;
end;
$function$;

revoke all on function public.write_market_fact(uuid, text, text, jsonb, text, jsonb, text, jsonb, text) from public, anon, authenticated;
