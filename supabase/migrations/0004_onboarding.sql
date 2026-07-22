-- NEXT_STEPS Phase 2 — real onboarding. Extends orgs with startup profile
-- fields and org_members with the joining person's profile, so a founder's
-- sign-up captures more than just an org name.

alter table orgs
  add column if not exists website text,
  add column if not exists sector text,
  add column if not exists stage stage,
  add column if not exists round_target_eur int,
  add column if not exists country text,
  add column if not exists one_liner text;

alter table org_members
  add column if not exists full_name text,
  add column if not exists title text,
  add column if not exists phone text,
  add column if not exists linkedin_url text;
