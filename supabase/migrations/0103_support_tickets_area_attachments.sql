-- Prompt 106 §4 — Report a problem widget. Extends support_tickets (0036)
-- rather than a new table: same intake, same backoffice queue, just two
-- new optional columns. `area` is a separate concept from `category`
-- (category stays question/problem/billing/etc.; area is "which part of
-- the app" — only meaningful for the Report-a-problem form, which fixes
-- category='problem' and asks for area instead of asking category again).
alter table public.support_tickets
  add column area text,
  add column attachment_urls text[] not null default '{}';
