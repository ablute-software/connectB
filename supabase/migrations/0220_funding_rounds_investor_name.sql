-- Prompt 327 Pedido B — Previous funding had label/amount/year but no field
-- for WHO invested, so the section read as empty of real investors while
-- suggestCapitalFixes()'s pipeline-hygiene suggestions (stale/frozen
-- interest) sat right above it, looking like the missing proof. Free text
-- (never a real catalog_entities link — not asked for, and most previous-
-- round investors predate this app's own catalog): the founder types who
-- invested, same discipline as `label` itself (free text because the real
-- taxonomy varies too much for an enum).
alter table funding_rounds add column if not exists investor_name text;
