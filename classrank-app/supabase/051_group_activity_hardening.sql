-- 051: correct the invite-join activity recorder in migration 050.
create or replace function public.join_study_group(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_group study_groups;
  v_rows integer := 0;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select * into v_group from study_groups where join_code = upper(trim(p_code));
  if not found then raise exception 'No group matches that code'; end if;
  if (select count(*) from group_members where group_id = v_group.id) >= 200 then
    raise exception 'This group is full';
  end if;
  insert into group_members(group_id, profile_id) values(v_group.id, v_uid) on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    insert into group_activity(group_id, profile_id, event_type) values(v_group.id, v_uid, 'joined');
  end if;
  return jsonb_build_object('group_id', v_group.id, 'name', v_group.name);
end;
$$;

create or replace function public.list_group_activity(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_group_manager(p_group_id) then
    raise exception 'Only the owner or an appointed admin can view group activity';
  end if;
  return coalesce((
    select jsonb_agg(x order by x.created_at desc)
    from (
      select a.profile_id, p.name, a.event_type, a.created_at
      from group_activity a
      left join profiles p on p.id = a.profile_id
      where a.group_id = p_group_id
      order by a.created_at desc
      limit 100
    ) x
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.join_study_group(text) from public;
grant execute on function public.join_study_group(text) to authenticated;
revoke all on function public.list_group_activity(uuid) from public;
grant execute on function public.list_group_activity(uuid) to authenticated;
