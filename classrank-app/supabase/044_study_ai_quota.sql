-- AI Companion free-tier guard: each authenticated account gets 5 requests per Lagos day.
-- The table is not directly readable or writable by clients. The SECURITY DEFINER RPC
-- uses auth.uid() from the caller JWT and atomically consumes one request.
create table if not exists public.study_ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (user_id, usage_date)
);

alter table public.study_ai_usage enable row level security;
revoke all on table public.study_ai_usage from anon, authenticated;

create or replace function public.consume_study_ai_quota(p_daily_limit integer default 5)
returns table (allowed boolean, used integer, daily_limit integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_usage_date date := (now() at time zone 'Africa/Lagos')::date;
  v_limit integer := least(greatest(coalesce(p_daily_limit, 5), 1), 20);
  v_count integer;
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  insert into public.study_ai_usage (user_id, usage_date, request_count)
  values (v_user_id, v_usage_date, 1)
  on conflict (user_id, usage_date)
  do update set request_count = public.study_ai_usage.request_count + 1
    where public.study_ai_usage.request_count < v_limit
  returning request_count into v_count;

  if v_count is null then
    select u.request_count into v_count
    from public.study_ai_usage as u
    where u.user_id = v_user_id and u.usage_date = v_usage_date;
    return query select false, coalesce(v_count, v_limit), v_limit;
  else
    return query select true, v_count, v_limit;
  end if;
end;
$$;

revoke all on function public.consume_study_ai_quota(integer) from public, anon;
grant execute on function public.consume_study_ai_quota(integer) to authenticated;
