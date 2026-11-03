-- Prompt 927 (E, 03/11/2026) — every file in a call is at most 12 MB. The code now clamps whatever is stored (maxFileMbOf), so this only makes the STORED limit say what is enforced: a File question whose limit
-- was larger than 12 MB, or missing ("no limit"), becomes 12; so does a File sub-question inside a group. A smaller limit is left alone. Data only (no schema change), idempotent.
-- APPLIED on 03/11/2026 to wkjcaoqdvhykrfacsylr (dry run in a rolled-back transaction first), before the code that clamps the limit was deployed.
-- At the time it was written it touched 7 File questions of one call, all at 25 MB (the INNOV-ID call 225a4520-…: 6.1, 6.2, 6.5.1, 6.5.2, 6.5.4, 6.6, 6.7); the group sub-questions were at 5 MB.
-- The Storage bucket `data-room` has no size limit of its own (file_size_limit null), so 12 MB is not cut short there.

update public.call_form_fields
   set validations = jsonb_set(coalesce(validations, '{}'::jsonb), '{maxFileMb}', '12'::jsonb), updated_at = now()
 where kind = 'file'
   and ((validations ->> 'maxFileMb') is null or (validations ->> 'maxFileMb')::numeric > 12);

update public.call_form_fields f
   set validations = jsonb_set(f.validations, '{group,subFields}', (
         select jsonb_agg(
                  case when s ->> 'kind' = 'file' and ((s -> 'validations' ->> 'maxFileMb') is null or (s -> 'validations' ->> 'maxFileMb')::numeric > 12)
                       then jsonb_set(s, '{validations}', coalesce(s -> 'validations', '{}'::jsonb) || '{"maxFileMb": 12}'::jsonb)
                       else s end
                  order by ord)
           from jsonb_array_elements(f.validations -> 'group' -> 'subFields') with ordinality as t(s, ord)
       )), updated_at = now()
 where f.kind = 'group'
   and jsonb_typeof(f.validations -> 'group' -> 'subFields') = 'array'
   and exists (
         select 1 from jsonb_array_elements(f.validations -> 'group' -> 'subFields') s
          where s ->> 'kind' = 'file' and ((s -> 'validations' ->> 'maxFileMb') is null or (s -> 'validations' ->> 'maxFileMb')::numeric > 12));
