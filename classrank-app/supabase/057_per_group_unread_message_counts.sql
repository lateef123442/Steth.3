-- 057: return unread study-group message counts per group for Community cards.
-- Run after 055_group_unread_messages.sql.

create or replace function public.my_unread_group_message_counts()
returns table(group_id uuid, unread_count integer)
language sql
stable
security definer
set search_path = public
as $$
  select gm.group_id, count(m.id)::integer as unread_count
  from public.group_members gm
  join public.group_messages m
    on m.group_id = gm.group_id
   and m.author_id <> auth.uid()
   and m.created_at > gm.last_read_at
   and (m.private_to is null or m.private_to = auth.uid())
  where gm.profile_id = auth.uid()
  group by gm.group_id;
$$;

revoke all on function public.my_unread_group_message_counts() from public, anon;
grant execute on function public.my_unread_group_message_counts() to authenticated;
