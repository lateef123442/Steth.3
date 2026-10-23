-- Course sharing: the teacher who created a course (or an admin) can let OTHER departments and years view it.
-- Run after 033_storage_buckets_fix.sql. Safe to run more than once.
--
-- How it works
--  * A course always belongs to one department + year (its "home"). Those students see it automatically.
--  * course_shares adds extra audiences: a department, and either ONE year of it or ALL its years (year = null).
--  * Students in a shared audience see the course in "My courses" and can read topics, take daily quizzes,
--    tests and exams, and appear in the course ranking, exactly like home students.
--  * Only staff of the course can change sharing. Students never read the table directly.

create table if not exists course_shares (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses (id) on delete cascade,
  department_id uuid not null references departments (id) on delete cascade,
  year int check (year between 1 and 7),          -- null = every year of that department
  created_at timestamptz not null default now()
);
create unique index if not exists uq_course_shares on course_shares (course_id, department_id, coalesce(year, 0));
create index if not exists idx_course_shares_audience on course_shares (department_id, year);

alter table course_shares enable row level security;
-- No policies on purpose: clients only go through the functions below.
revoke all on course_shares from anon, authenticated;

-- ─────────────────────────────────────────────
-- Who counts as a member / on the roster (home department + year, shared audiences, join-code members)
-- ─────────────────────────────────────────────
create or replace function course_roster(p_course uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select p.id from profiles p join courses c on c.id = p_course
   where p.role = 'student'
     and ((p.department_id = c.department_id and p.year = c.year)
          or exists (select 1 from course_shares s
                      where s.course_id = c.id and s.department_id = p.department_id
                        and (s.year is null or s.year = p.year)))
  union
  select m.profile_id from course_members m where m.course_id = p_course;
$$;

create or replace function is_course_member(p_course uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from course_members where course_id = p_course and profile_id = auth.uid())
      or exists (
        select 1 from courses c join profiles p on p.id = auth.uid()
         where c.id = p_course and p.role = 'student'
           and ((p.department_id = c.department_id and p.year = c.year)
                or exists (select 1 from course_shares s
                            where s.course_id = c.id and s.department_id = p.department_id
                              and (s.year is null or s.year = p.year))));
$$;

-- ─────────────────────────────────────────────
-- Teacher / admin: read and replace a course's sharing list
-- ─────────────────────────────────────────────
create or replace function staff_get_course_shares(p_course_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not is_course_staff(p_course_id) then raise exception 'Not authorized'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('department_id', s.department_id, 'department', d.name, 'year', s.year)
                     order by d.name, s.year nulls first)
      from course_shares s join departments d on d.id = s.department_id
     where s.course_id = p_course_id), '[]'::jsonb);
end;
$$;

-- p_shares example: [{"department_id": "<uuid>", "year": null}, {"department_id": "<uuid>", "year": 2}]
create or replace function staff_set_course_shares(p_course_id uuid, p_shares jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_course courses;
  r jsonb;
  v_dept uuid;
  v_year int;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not is_course_staff(p_course_id) then raise exception 'Not authorized'; end if;
  select * into v_course from courses where id = p_course_id;
  if not found then raise exception 'Course not found'; end if;
  if p_shares is null or jsonb_typeof(p_shares) <> 'array' then raise exception 'Invalid share list'; end if;
  if jsonb_array_length(p_shares) > 300 then raise exception 'Too many departments selected'; end if;

  delete from course_shares where course_id = p_course_id;
  for r in select * from jsonb_array_elements(p_shares) loop
    v_dept := nullif(r->>'department_id', '')::uuid;
    v_year := nullif(r->>'year', '')::int;
    if v_dept is null then continue; end if;
    if v_year is not null and v_year not between 1 and 7 then raise exception 'Year must be between 1 and 7'; end if;
    if not exists (select 1 from departments where id = v_dept) then raise exception 'Unknown department'; end if;
    -- the course's own department + year already sees it
    if v_dept = v_course.department_id and v_year is not distinct from v_course.year then continue; end if;
    insert into course_shares (course_id, department_id, year) values (p_course_id, v_dept, v_year) on conflict do nothing;
  end loop;
end;
$$;

-- ─────────────────────────────────────────────
-- Lists: teachers see how many audiences a course is shared with; students see which courses were shared with them
-- ─────────────────────────────────────────────
create or replace function staff_list_courses()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_role text;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select role into v_role from profiles where id = v_uid;
  if v_role not in ('teacher', 'admin') then raise exception 'Not authorized'; end if;
  return coalesce((
    select jsonb_agg(x order by x.year, x.code) from (
      select c.id, c.code, c.title, c.year, c.join_code, d.name as department, pr.name as teacher_name,
        (select count(*) from course_roster(c.id)) as member_count,
        (select count(*) from course_questions q where q.course_id = c.id) as question_count,
        (select count(*) from course_materials t where t.course_id = c.id) as material_count,
        (select count(*) from course_topics tp where tp.course_id = c.id) as topic_count,
        (select count(*) from course_shares sh where sh.course_id = c.id) as share_count
      from courses c
      join departments d on d.id = c.department_id
      join profiles pr on pr.id = c.created_by
      where v_role = 'admin' or c.created_by = v_uid
    ) x), '[]'::jsonb);
end;
$$;

create or replace function my_courses()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform require_pro();   -- keep the Pro check that 029 added to this function
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  return coalesce((
    select jsonb_agg(x order by x.code) from (
      select c.id, c.code, c.title, c.year, d.name as department, pr.name as teacher_name,
        (select count(*) from course_roster(c.id)) as member_count,
        (select min(e.event_date) from course_events e where e.course_id = c.id and e.kind = 'exam' and e.event_date >= current_date) as next_exam,
        (select count(*) from course_topics t where t.course_id = c.id) as topic_count,
        (select count(*) from course_topic_progress g where g.course_id = c.id and g.profile_id = auth.uid()) as topics_done,
        -- true when the course reached this student through sharing rather than their own department + year
        (not exists (select 1 from profiles me where me.id = auth.uid() and me.department_id = c.department_id and me.year = c.year)
         and exists (select 1 from course_shares s join profiles me on me.id = auth.uid()
                      where s.course_id = c.id and s.department_id = me.department_id and (s.year is null or s.year = me.year))) as shared_with_me
      from courses c
      join departments d on d.id = c.department_id
      join profiles pr on pr.id = c.created_by
      where is_course_member(c.id)
    ) x), '[]'::jsonb);
end;
$$;

-- Lock down who may call what (same pattern as 025)
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array['staff_get_course_shares', 'staff_set_course_shares', 'staff_list_courses', 'my_courses'])
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
