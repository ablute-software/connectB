-- Prompt 110 Block C — the platform-activity band on the investor card's
-- Track record slide. RLS blocks a startup from reading another org's
-- swipes/exposures/matches directly (matchdeal_swipes_own,
-- matchdeal_exposures_own, matchdeal_matches_participants all scope to
-- the caller's own profile) — confirmed live, this band is NOT free like
-- the rest of Block A. SECURITY DEFINER, aggregates only.
--
-- Non-negotiable design rules (from the prompt):
--   1. Only bucketed aggregates ever leave this function — never exact
--      counts, dates, or identities. With 6 startups in production,
--      "matches = 7" plus two more observations identifies who.
--   2. Each bucket returns null below a minimum sample size; the row
--      simply doesn't render below that.
--   3. member_since is always safe (matchdeal_profiles.created_at).
--   4. Does not touch access_grants or matchdeal_eligible_deck.
--   5. Called once per visible card, cached client-side per profile_id.
--
-- Exact bucket thresholds (25%/60% for likes ratio, 24h/7d for reply
-- speed) are this session's own reasonable defaults — the prompt named
-- the buckets ('selective'/'balanced'/'broad', 'fast'/'within_days'/
-- 'slow') but not the numeric cutoffs between them. Flagged, not hidden.
--
-- Honest state today (verified live): 73 exposures, 10 swipes, 3
-- matches, 3 messages — all kind='system'. Zero 'user' messages exist
-- anywhere. With the >=3-reply-conversation minimum below, replies_bucket
-- will return null for every profile until real conversations happen.
-- Not simulated, not seeded — see the prompt's own explicit instruction.
create or replace function public.matchdeal_investor_activity(p_profile_id uuid)
returns table (
  member_since date,
  likes_ratio_bucket text,
  replies_bucket text,
  matches_bucket text
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_member_since date;
  v_exposures_as_viewer integer;
  v_likes_given integer;
  v_swipes_given integer;
  v_likes_ratio_bucket text;
  v_reply_count integer;
  v_reply_avg_hours numeric;
  v_replies_bucket text;
  v_match_count integer;
  v_matches_bucket text;
begin
  select created_at::date into v_member_since from matchdeal_profiles where id = p_profile_id;

  -- Selective/balanced/broad: of the candidates shown TO this profile as
  -- a VIEWER, what share did it like? Needs >=20 exposures as viewer —
  -- a small sample is both noisy and easier to re-identify.
  select count(*) into v_exposures_as_viewer from matchdeal_exposures where viewer_profile_id = p_profile_id;
  select count(*) filter (where direction = 'like'), count(*)
    into v_likes_given, v_swipes_given
    from matchdeal_swipes where actor_profile_id = p_profile_id;
  if v_exposures_as_viewer >= 20 and v_swipes_given > 0 then
    v_likes_ratio_bucket := case
      when v_likes_given::numeric / v_swipes_given < 0.25 then 'selective'
      when v_likes_given::numeric / v_swipes_given <= 0.6 then 'balanced'
      else 'broad'
    end;
  end if;

  -- Reply speed: matches this profile is a participant in (either side),
  -- where a first 'user' message from one side got a 'user' reply from
  -- the other. matchdeal_messages has no read-receipt column, so this can
  -- only ever mean "time between first message and first reply," never
  -- "time to read." Needs >=3 such conversations.
  with my_matches as (
    select id from matchdeal_matches
    where startup_profile_id = p_profile_id or active_investor_profile_id = p_profile_id
  ),
  first_msgs as (
    select match_id, sender_profile_id, created_at,
           row_number() over (partition by match_id order by created_at) as rn
    from matchdeal_messages
    where match_id in (select id from my_matches) and kind = 'user'
  ),
  reply_pairs as (
    select a.match_id, a.created_at as asked_at, b.created_at as replied_at
    from first_msgs a
    join first_msgs b on b.match_id = a.match_id and b.sender_profile_id <> a.sender_profile_id and b.created_at > a.created_at
    where a.rn = 1
  )
  select count(*), avg(extract(epoch from (replied_at - asked_at)) / 3600.0)
    into v_reply_count, v_reply_avg_hours
    from reply_pairs;

  if v_reply_count >= 3 then
    v_replies_bucket := case
      when v_reply_avg_hours <= 24 then 'fast'
      when v_reply_avg_hours <= 24 * 7 then 'within_days'
      else 'slow'
    end;
  end if;

  -- Matches: needs >=1 to report at all (no minimum beyond "at least
  -- something happened").
  select count(*) into v_match_count from matchdeal_matches
    where startup_profile_id = p_profile_id or active_investor_profile_id = p_profile_id;
  if v_match_count >= 1 then
    v_matches_bucket := case
      when v_match_count <= 5 then '1-5'
      when v_match_count <= 20 then '6-20'
      else '20+'
    end;
  end if;

  return query select v_member_since, v_likes_ratio_bucket, v_replies_bucket, v_matches_bucket;
end;
$function$;
grant execute on function public.matchdeal_investor_activity(uuid) to authenticated;
