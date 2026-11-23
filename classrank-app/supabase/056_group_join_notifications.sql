-- 056: unread member-joined activity for group owners and admins
create table if not exists public.group_activity_reads (
  group_id uuid not null references public.study_groups(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default 'epoch'::timestamptz,
  primary key (group_id, profile_id)
);
create index if not exists group_activity_reads_profile_idx on public.group_activity_reads(profile_id, group_id);
alter table public.group_activity_reads enable row level security;
drop policy if exists group_activity_reads_select_own on public.group_activity_reads;
create policy group_activity_reads_select_own on public.group_activity_reads for select to authenticated using (profile_id = auth.uid());
drop policy if exists group_activity_reads_insert_own on public.group_activity_reads;
create policy group_activity_reads_insert_own on public.group_activity_reads for insert to authenticated with check (profile_id = auth.uid() and public.is_group_manager(group_id));
drop policy if exists group_activity_reads_update_own on public.group_activity_reads;
create policy group_activity_reads_update_own on public.group_activity_reads for update to authenticated using (profile_id = auth.uid() and public.is_group_manager(group_id)) with check (profile_id = auth.uid() and public.is_group_manager(group_id));

create or replace function public.my_unread_group_join_counts()
returns table(group_id uuid, unread_count bigint)
language sql stable security definer set search_path = public as $$
  select a.group_id, count(*)::bigint
  from public.group_activity a
  join public.group_members gm on gm.group_id = a.group_id and gm.profile_id = auth.uid()
  left join public.group_activity_reads r on r.group_id = a.group_id and r.profile_id = auth.uid()
  where a.event_type = 'joined'
    and a.profile_id is distinct from auth.uid()
    and public.is_group_manager(a.group_id)
    and a.created_at > coalesce(r.last_read_at, 'epoch'::timestamptz)
  group by a.group_id;
$$;

create or replace function public.mark_group_join_activity_read(p_group_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_group_manager(p_group_id) then
    raise exception 'Only the group owner or an appointed admin can mark member activity as read';
  end if;
  insert into public.group_activity_reads(group_id, profile_id, last_read_at)
  values (p_group_id, auth.uid(), now())
  on conflict (group_id, profile_id) do update set last_read_at = excluded.last_read_at;
end;
$$;
revoke all on function public.my_unread_group_join_counts() from public, anon;
grant execute on function public.my_unread_group_join_counts() to authenticated;
revoke all on function public.mark_group_join_activity_read(uuid) from public, anon;
grant execute on function public.mark_group_join_activity_read(uuid) to authenticated;
