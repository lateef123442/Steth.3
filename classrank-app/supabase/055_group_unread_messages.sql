-- 055: unread study-group message counts and per-member read receipts.
-- Run after 054_official_group_welcome.sql.

alter table public.group_members
  add column if not exists last_read_at timestamptz not null default now();

create index if not exists idx_group_members_unread
  on public.group_members(profile_id, group_id, last_read_at);

create or replace function public.mark_group_messages_read(p_group_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  update public.group_members
  set last_read_at = now()
  where group_id = p_group_id and profile_id = auth.uid();
  if not found then raise exception 'Not a member of this group'; end if;
end;
$$;

create or replace function public.my_unread_group_message_count()
returns integer language plpgsql stable security definer set search_path = public as $$
declare v_count integer;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select count(*)::integer into v_count
  from public.group_messages m
  join public.group_members gm on gm.group_id = m.group_id and gm.profile_id = auth.uid()
  where m.author_id <> auth.uid()
    and m.created_at > gm.last_read_at
    and (m.private_to is null or m.private_to = auth.uid());
  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.mark_group_messages_read(uuid) from public, anon;
revoke all on function public.my_unread_group_message_count() from public, anon;
grant execute on function public.mark_group_messages_read(uuid) to authenticated;
grant execute on function public.my_unread_group_message_count() to authenticated;
