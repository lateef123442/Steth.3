-- 056: unread feed post counts per profile. Run after 055_group_unread_messages.sql.
-- Tracks new visible posts separately from chat messages and friend requests.

alter table public.profiles
  add column if not exists feed_last_read_at timestamptz not null default now();

create or replace function public.mark_feed_posts_read()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  update public.profiles set feed_last_read_at = now() where id = auth.uid();
  if not found then raise exception 'Profile not found'; end if;
end;
$$;

create or replace function public.my_unread_feed_post_count()
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_department uuid;
  v_last_read timestamptz;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select department_id, feed_last_read_at into v_department, v_last_read
  from public.profiles where id = auth.uid();
  if v_department is null then return 0; end if;
  select count(*)::integer into v_count
  from public.posts p
  where p.author_id <> auth.uid()
    and p.created_at > coalesce(v_last_read, now())
    and (p.is_public = true or p.department_id = v_department);
  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.mark_feed_posts_read() from public, anon;
revoke all on function public.my_unread_feed_post_count() from public, anon;
grant execute on function public.mark_feed_posts_read() to authenticated;
grant execute on function public.my_unread_feed_post_count() to authenticated;
