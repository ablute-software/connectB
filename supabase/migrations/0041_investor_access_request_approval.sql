-- Back-office approval for investor_access_requests (0039). Until now the
-- table only tracked contacted_at/contacted_by — a "we reached out" note,
-- with no way to actually grant the requester the investor role. Approving
-- a request now creates a real access_grants row (the same mechanism
-- founders use to share their Data Room), which is what resolveRole()
-- actually checks to hand out the 'investor' role.
alter table investor_access_requests
  add column status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  add column reviewed_by uuid references auth.users(id),
  add column reviewed_at timestamptz,
  add column access_grant_id uuid references access_grants(id) on delete set null;

create index on investor_access_requests (status, created_at);
