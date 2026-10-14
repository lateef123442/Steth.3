-- 030: Allow up to 100 files per course (was 40) so a teacher can upload a full set of past questions.
-- Run after 022 and 025. Safe to run more than once. Edits the limit inside staff_add_file_material in place.
do $$
declare r record; newdef text; n int := 0;
begin
  for r in select p.oid, pg_get_functiondef(p.oid) as def
           from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
           where ns.nspname = 'public' and p.proname = 'staff_add_file_material'
  loop
    newdef := replace(replace(r.def, '>= 40 then', '>= 100 then'), 'already has 40 files', 'already has 100 files');
    if newdef <> r.def then execute newdef; n := n + 1; end if;
  end loop;
  raise notice 'File limit raised to 100 in % function(s).', n;
end $$;
