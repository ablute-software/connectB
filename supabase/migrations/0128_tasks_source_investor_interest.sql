-- relatorio_verificacao_..._20260805 §3 — widens tasks.source (0065) to
-- accept 'investor_interest', the provenance value the "respond to
-- expressed interest" follow-up task (created by
-- matchdeal_record_interest_notification going forward, see the API route
-- change in the same commit) is tagged with — distinct from a founder's own
-- 'manual' task or the relationship engine's 'suggested' one, and specific
-- enough that the auto-close rule (also in that same change) can find
-- exactly these tasks without matching on title text. Purely additive:
-- existing rows and the two prior values are unaffected.
alter table tasks drop constraint if exists tasks_source_check;
alter table tasks add constraint tasks_source_check
  check (source is null or source = any (array['suggested', 'manual', 'investor_interest']));
