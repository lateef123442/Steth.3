-- 038: ONE switch for the whole app: free for everyone, or paid (Pro required for students). Only an admin can flip it.
-- Run AFTER 029 (and the other earlier migrations). Safe to run more than once.
--
--  * Starts as FREE: every student can use everything with no subscription.
--  * Turning it to PAID brings back the existing rules exactly as before: students need active Pro (a subscription, a
--    code, or an invite reward). Pro time that students already have is kept, so nobody loses what they were given.
--  * Teachers and admins are never blocked either way.
--  * The check lives in the database (is_pro_active), so every feature, table and view follows the switch at once.

create table if not exists app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles (id) on delete set null
);
alter table app_settings enable row level security;   -- no client policies: only the functions below touch it
revoke all on app_settings from anon, authenticated;

-- Start free. (Does nothing if the admin has already chosen.)
insert into app_settings (key, value) values ('paywall_enabled', 'false'::jsonb) on conflict (key) do nothing;

create or replace function paywall_enabled() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (value)::boolean from app_settings where key = 'paywall_enabled'), false);
$$;

-- The same check 029 introduced, now respecting the switch.
create or replace function is_pro_active() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and (
       not paywall_enabled()
       or exists (
         select 1 from profiles p
         where p.id = auth.uid()
           and (p.role in ('teacher', 'admin') or (p.is_pro and p.pro_expires_at > now()))
       )
     );
$$;

-- What the app reads after sign-in.
create or replace function get_app_config() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('paywall_enabled', paywall_enabled());
$$;

-- Admin screen: current setting, plus how many students would be locked out if it were paid right now.
create or replace function admin_get_paywall() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then raise exception 'Not authorized'; end if;
  return jsonb_build_object(
    'paywall_enabled', paywall_enabled(),
    'students_total', (select count(*) from profiles where role = 'student'),
    'students_without_pro', (select count(*) from profiles where role = 'student' and not (is_pro and pro_expires_at > now())),
    'updated_at', (select updated_at from app_settings where key = 'paywall_enabled')
  );
end;
$$;

create or replace function admin_set_paywall(p_enabled boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then raise exception 'Not authorized'; end if;
  if p_enabled is null then raise exception 'Choose free or paid'; end if;
  insert into app_settings (key, value, updated_at, updated_by)
  values ('paywall_enabled', to_jsonb(p_enabled), now(), auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  return admin_get_paywall();
end;
$$;

revoke all on function paywall_enabled(), is_pro_active(), get_app_config(), admin_get_paywall(), admin_set_paywall(boolean) from public;
grant execute on function is_pro_active(), get_app_config() to authenticated;
grant execute on function admin_get_paywall(), admin_set_paywall(boolean) to authenticated;
-- paywall_enabled() is only called from inside the functions above (which run with their owner's rights).

notify pgrst, 'reload schema';
