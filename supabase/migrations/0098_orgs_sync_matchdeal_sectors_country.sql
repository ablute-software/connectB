-- Addenda ao Prompt 98 §2 — sectors/country stay editable on
-- matchdeal_profiles (matchdeal_eligible_deck() filters on those columns,
-- not orgs, for real matching), but ProfilePanel.tsx's read-only orgs
-- block needs them to reflect the Sherlock Deal settings value once
-- ProfilePanel stops offering a second edit form for them. This trigger
-- propagates orgs.sectors/country onto the linked startup matchdeal_profiles
-- row whenever either changes — matchdeal_eligible_deck() itself is
-- completely untouched.
create or replace function public.orgs_sync_matchdeal_sectors_country()
returns trigger
language plpgsql
as $function$
begin
  if (new.sectors is distinct from old.sectors) or (new.country is distinct from old.country) then
    update public.matchdeal_profiles
      set sectors = new.sectors, country = new.country, updated_at = now()
      where membership_id = new.id and kind = 'startup';
  end if;
  return new;
end;
$function$;

create trigger orgs_sync_matchdeal_sectors_country
after update on public.orgs
for each row execute function public.orgs_sync_matchdeal_sectors_country();
