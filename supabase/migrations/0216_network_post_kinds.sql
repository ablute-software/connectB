-- Prompt 322 — My Network 7/9: structured updates + round milestones.
-- Extends network_posts (321) with a `kind` discriminator rather than a new
-- table — same visibility/RLS/linter/soft-delete a plain post already has,
-- exactly what the prompt asks for ("publica-se pela mesma infraestrutura").
-- structured is only ever populated for kind='update'; kind='milestone'
-- posts carry their fixed template text in `body` alone (no structured
-- payload — there's nothing optional to fill in, the whole post IS the
-- template). Deliberately no `round` key anywhere in the structured shape
-- (Pedido A's own explicit prohibition, enforced in TypeScript by
-- UpdateStructured's own type, not by a DB constraint that would need
-- updating every time the shape changes).
alter table network_posts
  add column if not exists kind text not null default 'freeform' check (kind in ('freeform', 'update', 'milestone')),
  add column if not exists structured jsonb;
