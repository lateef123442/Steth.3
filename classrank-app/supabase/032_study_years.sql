-- Years of study offered at signup. Admins add/remove them (valid range 1–7, matching courses and teacher assignments).
create table if not exists study_years (
  year int primary key check (year between 1 and 7)
);
insert into study_years (year) values (1),(2),(3),(4),(5) on conflict do nothing;

alter table study_years enable row level security;
drop policy if exists "study_years readable" on study_years;
create policy "study_years readable" on study_years for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on study_years from anon, authenticated;

create or replace function admin_add_year(p_year int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select role from profiles where id = auth.uid()) is distinct from 'admin' then raise exception 'Not authorized'; end if;
  if p_year is null or p_year not between 1 and 7 then raise exception 'Year must be between 1 and 7'; end if;
  insert into study_years (year) values (p_year) on conflict do nothing;
end; $$;

create or replace function admin_remove_year(p_year int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select role from profiles where id = auth.uid()) is distinct from 'admin' then raise exception 'Not authorized'; end if;
  if (select count(*) from study_years) <= 1 then raise exception 'At least one year must remain'; end if;
  delete from study_years where year = p_year;  -- existing students keep their year; it just stops being offered at signup
end; $$;

revoke all on function admin_add_year(int), admin_remove_year(int) from public;
grant execute on function admin_add_year(int), admin_remove_year(int) to authenticated;
