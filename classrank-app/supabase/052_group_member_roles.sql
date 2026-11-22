-- 052: expose group-specific roles in the group member list.
create or replace function public.group_members_list(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_group_member(p_group_id) then raise exception 'Not a member of this group'; end if;
  return coalesce((
    select jsonb_agg(x order by x.is_owner desc, x.name)
    from (
      select pr.id, pr.name, d.name as department, pr.year, pr.avatar_path, pr.role,
        (g.owner_id = pr.id) as is_owner,
        case when g.owner_id = pr.id then 'owner' else m.group_role end as group_role
      from group_members m join study_groups g on g.id = m.group_id
      join profiles pr on pr.id = m.profile_id left join departments d on d.id = pr.department_id
      where m.group_id = p_group_id limit 500
    ) x
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.group_members_list(uuid) from public;
grant execute on function public.group_members_list(uuid) to authenticated;
