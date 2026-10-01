-- Prompt AL757 — Nuno's own test file carried a "Tel." column; it mapped
-- to nothing (contact_email only accepted "email") and disappeared with no
-- warning that it had been ignored. Added as a new column rather than
-- folded into an existing one (contact_name/contact_email already have
-- their own meaning) — plain text, optional, trimmed only at write time:
-- phone formats vary too much internationally (country code, extensions,
-- local conventions) to validate meaningfully here.
alter table public.investor_portfolio_companies add column contact_phone text;

comment on column public.investor_portfolio_companies.contact_phone is
  'Prompt AL757 — optional free-text phone number for the portfolio company''s contact. Not validated (international formats vary too much); only trimmed at write time.';
