-- 061: reconcile student membership before returning study groups.
-- Fixes groups created before all eligible students were enrolled, and keeps
-- course-linked groups visible to every student currently enrolled in a course.

create or replace function public.my_study_groups()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_department_id uuid;
  v_year integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select p.role, p.department_id, p.year
    into v_role, v_department_id, v_year
  from public.profiles p
  where p.id = v_uid;

  -- Reconcile all official class groups for this student's exact cohort.
  -- This is intentionally additive: it never removes existing memberships.
  if v_role = 'student' then
    if v_department_id is not null and v_year is not null then
      insert into public.group_members (group_id, profile_id)
      select g.id, v_uid
      from public.study_groups g
      where g.official = true
        and g.department_id = v_department_id
        and g.year = v_year
      on conflict do nothing;
    end if;

    -- Reconcile every course-linked group for every course the student joined.
    insert into public.group_members (group_id, profile_id)
    select g.id, cm.profile_id
    from public.study_groups g
    join public.course_members cm on cm.course_id = g.course_id
    where g.course_id is not null
      and cm.profile_id = v_uid
    on conflict do nothing;
  end if;

  return coalesce((
    select jsonb_agg(x order by x.official desc nulls last, x.name)
    from (
      select
        g.id,
        g.name,
        g.description,
        g.owner_id,
        g.course_id,
        g.group_avatar_path,
        g.year,
        g.official,
        (select pr.name from public.profiles pr where pr.id = g.owner_id) as owner_name,
        case when g.owner_id = v_uid then g.join_code else null end as join_code,
        (select count(*) from public.group_members m2 where m2.group_id = g.id) as member_count,
        (
          select c.title
          from public.group_challenges c
          where c.group_id = g.id
            and c.ends_on >= current_date
          order by c.ends_on
          limit 1
        ) as active_challenge
      from public.study_groups g
      join public.group_members m
        on m.group_id = g.id
       and m.profile_id = v_uid
    ) x
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.my_study_groups() from public, anon;
grant execute on function public.my_study_groups() to authenticated;
