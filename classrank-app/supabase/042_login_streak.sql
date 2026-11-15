-- 042: a separate streak for consecutive calendar days the student opens/logs into Steth.
-- This intentionally does NOT reuse current_streak/last_quiz_date, which remain the study-activity streak.
alter table public.profiles
  add column if not exists login_streak integer not null default 0,
  add column if not exists last_login_date date;

create or replace function public.record_login_streak()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_last date;
  v_streak integer;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;

  select last_login_date, login_streak
    into v_last, v_streak
    from public.profiles
    where id = v_user and role = 'student'
    for update;

  if not found then
    return;
  end if;

  if v_last = v_today then
    return; -- multiple logins/opens on the same day count only once
  elsif v_last = v_today - 1 then
    update public.profiles
      set login_streak = coalesce(v_streak, 0) + 1, last_login_date = v_today
      where id = v_user;
  else
    update public.profiles
      set login_streak = 1, last_login_date = v_today
      where id = v_user;
  end if;
end;
$$;

revoke all on function public.record_login_streak() from public, anon;
grant execute on function public.record_login_streak() to authenticated;

notify pgrst, 'reload schema';
