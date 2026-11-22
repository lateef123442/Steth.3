-- Student/teacher/admin self-service account details.
-- Existing accounts keep a NULL username until they choose one.

alter table public.profiles
  add column if not exists username text;

create unique index if not exists profiles_username_lower_uidx
  on public.profiles (lower(username))
  where username is not null;

alter table public.profiles
  drop constraint if exists profiles_username_format_check;

alter table public.profiles
  add constraint profiles_username_format_check
  check (username is null or username ~ '^[a-z0-9_]{3,20}$');

create or replace function public.update_my_account_profile(
  p_name text,
  p_username text
)
returns table (name text, username text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_username text := lower(btrim(regexp_replace(coalesce(p_username, ''), '^@', '')));
begin
  if v_user_id is null then
    raise exception 'You must be signed in to update your profile.';
  end if;
  if length(v_name) < 2 or length(v_name) > 60 then
    raise exception 'Name must be between 2 and 60 characters.';
  end if;
  if v_username !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'Username must be 3–20 characters using lowercase letters, numbers or underscores.';
  end if;

  begin
    update public.profiles p
      set name = v_name,
          username = v_username
      where p.id = v_user_id;
    if not found then
      raise exception 'Your profile could not be found.';
    end if;
  exception when unique_violation then
    raise exception 'That username is already taken.' using errcode = '23505';
  end;

  return query
    select p.name, p.username
    from public.profiles p
    where p.id = v_user_id;
end;
$$;

revoke all on function public.update_my_account_profile(text, text) from public, anon;
grant execute on function public.update_my_account_profile(text, text) to authenticated;
