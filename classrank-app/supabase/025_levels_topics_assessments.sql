-- Department + level (year) aware courses, topics with resources, per-course daily quizzes,
-- and gated practical / test / exam assessments.
-- Run after 024_departments_rls.sql.  NOT yet executed: review and test on staging first.
--
-- What changes
--  1. courses.year       Every course belongs to a department AND a year/level. A student automatically sees the
--                        courses whose department and year match their own profile (no join code needed). Join codes
--                        still work for cross-listing.
--  2. teaching_years     Admin assigns which years a teacher covers. Teachers can only create courses (and so only
--                        upload content) for their own department and those years. Empty list = every year of their
--                        department, so existing teachers are not locked out until an admin assigns years.
--  3. course_topics      A course is a list of topics. Resources (notes, links, videos, files) hang off a topic, as
--                        many as the teacher likes.
--  4. Progress           Students open resources (recorded server-side) and then finish a topic. Practice questions
--                        for a topic are only DELIVERED to the student's phone after they finish that topic.
--                        Test and exam can only be started once EVERY topic in the course is finished.
--  5. Question purposes  practice | daily | assessment. Daily and assessment questions are never sent to students
--                        with their answers; they are graded on the server.
--  6. Daily quizzes      Per course. Questions come from topics the student has started reading, a few per day.
--                        Only the FIRST answer to a question counts (and earns points).
--  7. Assessments        course_exams gets a kind: practical | test | exam. One attempt each, so the first score
--                        is the score. Points are added to the student's leaderboard total on submission.

-- ─────────────────────────────────────────────
-- A. Teacher assignment + course level
-- ─────────────────────────────────────────────
alter table profiles add column if not exists teaching_years int[] not null default '{}';
alter table profiles drop constraint if exists teaching_years_range;
alter table profiles add constraint teaching_years_range check (teaching_years <@ array[1,2,3,4,5,6,7]);

alter table courses add column if not exists year int;
update courses c set year = coalesce((
  select p.year from course_members m join profiles p on p.id = m.profile_id
  where m.course_id = c.id and p.year is not null
  group by p.year order by count(*) desc limit 1), 1)
where c.year is null;
alter table courses alter column year set not null;
alter table courses drop constraint if exists courses_year_range;
alter table courses add constraint courses_year_range check (year between 1 and 7);
create index if not exists idx_courses_dept_year on courses (department_id, year);

-- Who is in a course: every student in its department + year, plus anyone who joined with the code.
create or replace function course_roster(p_course uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select p.id from profiles p join courses c on c.id = p_course
   where p.role = 'student' and p.department_id = c.department_id and p.year = c.year
  union
  select m.profile_id from course_members m where m.course_id = p_course;
$$;

-- Students see (and can read the content of) courses that match their department + year.
create or replace function is_course_member(p_course uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from course_members where course_id = p_course and profile_id = auth.uid())
      or exists (
        select 1 from courses c join profiles p on p.id = auth.uid()
         where c.id = p_course and p.role = 'student'
           and p.department_id = c.department_id and p.year = c.year);
$$;

create or replace function admin_set_teacher_years(p_teacher uuid, p_years int[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then raise exception 'Not authorized'; end if;
  if not exists (select 1 from profiles where id = p_teacher and role = 'teacher') then raise exception 'That user is not a teacher'; end if;
  if p_years is null then p_years := '{}'; end if;
  if not (p_years <@ array[1,2,3,4,5,6,7]) then raise exception 'Years must be between 1 and 7'; end if;
  update profiles set teaching_years = (select coalesce(array_agg(distinct y order by y), '{}') from unnest(p_years) y)
   where id = p_teacher;
end;
$$;

create or replace function admin_get_teacher_years(p_teacher uuid) returns int[]
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then raise exception 'Not authorized'; end if;
  return (select teaching_years from profiles where id = p_teacher and role = 'teacher');
end;
$$;

-- ─────────────────────────────────────────────
-- B. Topics, progress, daily answers
-- ─────────────────────────────────────────────
create table if not exists course_topics (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses (id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 80),
  summary text not null default '' check (char_length(summary) <= 500),
  position int not null default 0,
  created_by uuid not null references profiles (id),
  created_at timestamptz not null default now()
);
create unique index if not exists uq_course_topics_title on course_topics (course_id, lower(title));
create index if not exists idx_course_topics_course on course_topics (course_id, position);

alter table course_materials add column if not exists topic_id uuid references course_topics (id) on delete set null;
alter table course_questions add column if not exists topic_id uuid references course_topics (id) on delete set null;
alter table course_questions add column if not exists purpose text not null default 'practice';
alter table course_questions drop constraint if exists course_questions_purpose_check;
alter table course_questions add constraint course_questions_purpose_check check (purpose in ('practice', 'daily', 'assessment'));
create index if not exists idx_course_materials_topic on course_materials (topic_id);
create index if not exists idx_course_questions_topic on course_questions (topic_id);

-- Turn the old free-text topic labels into real topics (idempotent).
insert into course_topics (course_id, title, created_by, position)
select s.course_id, s.topic, s.created_by, (row_number() over (partition by s.course_id order by s.topic)) - 1
from (
  select course_id, trim(topic) as topic, min(created_by::text)::uuid as created_by
  from (select course_id, topic, created_by from course_materials union all select course_id, topic, created_by from course_questions) u
  where trim(topic) <> '' group by course_id, trim(topic)
) s
on conflict do nothing;
update course_materials m set topic_id = t.id from course_topics t
 where m.topic_id is null and t.course_id = m.course_id and lower(t.title) = lower(trim(m.topic)) and trim(m.topic) <> '';
update course_questions q set topic_id = t.id from course_topics t
 where q.topic_id is null and t.course_id = q.course_id and lower(t.title) = lower(trim(q.topic)) and trim(q.topic) <> '';

create table if not exists course_material_reads (
  material_id uuid not null references course_materials (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  course_id uuid not null references courses (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (material_id, profile_id)
);
create index if not exists idx_material_reads_profile on course_material_reads (profile_id, course_id);

create table if not exists course_topic_progress (
  topic_id uuid not null references course_topics (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  course_id uuid not null references courses (id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (topic_id, profile_id)
);
create index if not exists idx_topic_progress_profile on course_topic_progress (profile_id, course_id);

create table if not exists course_daily_answers (
  question_id uuid not null references course_questions (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  course_id uuid not null references courses (id) on delete cascade,
  picked smallint not null check (picked between 0 and 3),
  correct boolean not null,
  answered_on date not null default current_date,
  created_at timestamptz not null default now(),
  primary key (question_id, profile_id)
);
create index if not exists idx_daily_answers_day on course_daily_answers (profile_id, course_id, answered_on);

-- Same model as 017: RLS on, no policies; everything goes through the functions below.
alter table course_topics enable row level security;
alter table course_material_reads enable row level security;
alter table course_topic_progress enable row level security;
alter table course_daily_answers enable row level security;

-- True when the course has topics and the student has finished every one of them.
create or replace function course_completed(p_course uuid, p_profile uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from course_topics where course_id = p_course)
     and not exists (
       select 1 from course_topics t where t.course_id = p_course
          and not exists (select 1 from course_topic_progress g where g.topic_id = t.id and g.profile_id = p_profile));
$$;

-- ─────────────────────────────────────────────
-- C. Teacher: create courses (department + year), topics, resources, questions
-- ─────────────────────────────────────────────
drop function if exists create_course(uuid, text, text);
create or replace function create_course(p_department_id uuid, p_code text, p_title text, p_year int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role text; v_dept uuid; v_years int[];
  v_row courses;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select role, department_id, teaching_years into v_role, v_dept, v_years from profiles where id = v_uid;
  if v_role not in ('teacher', 'admin') then raise exception 'Not authorized'; end if;
  if p_year is null or p_year not between 1 and 7 then raise exception 'Choose the year (level) this course is for'; end if;
  if v_role = 'teacher' then
    if v_dept is distinct from p_department_id then raise exception 'Teachers can only create courses in their own department'; end if;
    if coalesce(array_length(v_years, 1), 0) > 0 and not (p_year = any (v_years)) then
      raise exception 'You are not assigned to Year %. Ask an admin to assign it.', p_year;
    end if;
  end if;
  if char_length(trim(p_code)) < 2 or char_length(trim(p_title)) < 2 then raise exception 'Course code and title are required'; end if;
  insert into courses (department_id, year, code, title, created_by)
  values (p_department_id, p_year, upper(trim(p_code)), trim(p_title), v_uid) returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'join_code', v_row.join_code);
end;
$$;

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
        (select count(*) from course_topics tp where tp.course_id = c.id) as topic_count
      from courses c
      join departments d on d.id = c.department_id
      join profiles pr on pr.id = c.created_by
      where v_role = 'admin' or c.created_by = v_uid
    ) x), '[]'::jsonb);
end;
$$;

create or replace function staff_save_topic(p_id uuid, p_course_id uuid, p_title text, p_summary text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_title text := trim(p_title);
begin
  if not is_course_staff(p_course_id) then raise exception 'Not authorized'; end if;
  if char_length(v_title) < 1 then raise exception 'Give the topic a name'; end if;
  if p_id is null then
    if (select count(*) from course_topics where course_id = p_course_id) >= 60 then raise exception 'A course can have up to 60 topics'; end if;
    insert into course_topics (course_id, title, summary, position, created_by)
    values (p_course_id, v_title, coalesce(trim(p_summary), ''),
            coalesce((select max(position) + 1 from course_topics where course_id = p_course_id), 0), auth.uid())
    returning id into v_id;
  else
    update course_topics set title = v_title, summary = coalesce(trim(p_summary), '')
     where id = p_id and course_id = p_course_id returning id into v_id;
    if v_id is null then raise exception 'Topic not found'; end if;
    update course_materials set topic = v_title where topic_id = v_id;
    update course_questions set topic = v_title where topic_id = v_id;
  end if;
  return v_id;
exception when unique_violation then raise exception 'This course already has a topic called "%"', v_title;
end;
$$;

-- Deleting a topic keeps its resources and questions (they move to "General").
create or replace function staff_delete_topic(p_topic_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_course uuid;
begin
  select course_id into v_course from course_topics where id = p_topic_id;
  if v_course is null or not is_course_staff(v_course) then raise exception 'Not authorized'; end if;
  update course_materials set topic = '', topic_id = null where topic_id = p_topic_id;
  update course_questions set topic = '', topic_id = null where topic_id = p_topic_id;
  delete from course_topics where id = p_topic_id;
end;
$$;

create or replace function staff_move_topic(p_topic_id uuid, p_direction int) returns void
language plpgsql security definer set search_path = public as $$
declare v_t course_topics; v_other course_topics;
begin
  select * into v_t from course_topics where id = p_topic_id;
  if not found or not is_course_staff(v_t.course_id) then raise exception 'Not authorized'; end if;
  if p_direction < 0 then
    select * into v_other from course_topics where course_id = v_t.course_id and (position, created_at) < (v_t.position, v_t.created_at) order by position desc, created_at desc limit 1;
  else
    select * into v_other from course_topics where course_id = v_t.course_id and (position, created_at) > (v_t.position, v_t.created_at) order by position, created_at limit 1;
  end if;
  if not found then return; end if;
  -- normalise to unique positions first so the swap is meaningful even when positions tie
  with ordered as (select id, row_number() over (order by position, created_at) - 1 as n from course_topics where course_id = v_t.course_id)
  update course_topics t set position = o.n from ordered o where t.id = o.id;
  select * into v_t from course_topics where id = p_topic_id;
  select * into v_other from course_topics where id = v_other.id;
  update course_topics set position = v_other.position where id = v_t.id;
  update course_topics set position = v_t.position where id = v_other.id;
end;
$$;

create or replace function staff_save_material(
  p_id uuid, p_course_id uuid, p_topic_id uuid, p_title text, p_kind text, p_body text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_topic text := '';
begin
  if not is_course_staff(p_course_id) then raise exception 'Not authorized'; end if;
  if p_kind not in ('note', 'link', 'video') then raise exception 'Use the file upload for files'; end if;
  if p_topic_id is not null then
    select title into v_topic from course_topics where id = p_topic_id and course_id = p_course_id;
    if v_topic is null then raise exception 'Topic not found'; end if;
  end if;
  if p_id is null then
    insert into course_materials (course_id, topic, topic_id, title, kind, body, created_by)
    values (p_course_id, v_topic, p_topic_id, trim(p_title), p_kind, trim(p_body), auth.uid()) returning id into v_id;
  else
    update course_materials set topic = v_topic, topic_id = p_topic_id, title = trim(p_title), kind = p_kind, body = trim(p_body)
     where id = p_id and course_id = p_course_id and kind <> 'file' returning id into v_id;
    if v_id is null then raise exception 'Resource not found'; end if;
  end if;
  return v_id;
end;
$$;

-- File resources: the existing registration function does the storage checks; this attaches the topic.
create or replace function staff_add_file_to_topic(p_course_id uuid, p_topic_id uuid, p_title text, p_path text, p_file_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_topic text := ''; v_id uuid;
begin
  if not is_course_staff(p_course_id) then raise exception 'Not authorized'; end if;
  if p_topic_id is not null then
    select title into v_topic from course_topics where id = p_topic_id and course_id = p_course_id;
    if v_topic is null then raise exception 'Topic not found'; end if;
  end if;
  v_id := staff_add_file_material(p_course_id, v_topic, p_title, p_path, p_file_name);
  update course_materials set topic_id = p_topic_id where id = v_id;
  return v_id;
end;
$$;

-- p_purpose: practice (students study with it after finishing the topic) | daily (served one by one, graded on the
-- server) | assessment (only ever appears inside a practical / test / exam you schedule).
create or replace function staff_save_question(
  p_id uuid, p_course_id uuid, p_topic_id uuid, p_purpose text, p_question text, p_options text[], p_correct_index int, p_explanation text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_topic text := '';
begin
  if not is_course_staff(p_course_id) then raise exception 'Not authorized'; end if;
  if p_purpose not in ('practice', 'daily', 'assessment') then raise exception 'Unknown question type'; end if;
  if array_length(p_options, 1) is distinct from 4 then raise exception 'Exactly four options are required'; end if;
  if p_correct_index < 0 or p_correct_index > 3 then raise exception 'correct_index out of range'; end if;
  if p_topic_id is not null then
    select title into v_topic from course_topics where id = p_topic_id and course_id = p_course_id;
    if v_topic is null then raise exception 'Topic not found'; end if;
  end if;
  if p_id is null then
    insert into course_questions (course_id, topic, topic_id, purpose, question, options, correct_index, explanation, created_by)
    values (p_course_id, v_topic, p_topic_id, p_purpose, trim(p_question), p_options, p_correct_index, coalesce(trim(p_explanation), ''), auth.uid())
    returning id into v_id;
  else
    update course_questions set topic = v_topic, topic_id = p_topic_id, purpose = p_purpose, question = trim(p_question), options = p_options,
      correct_index = p_correct_index, explanation = coalesce(trim(p_explanation), '')
     where id = p_id and course_id = p_course_id returning id into v_id;
    if v_id is null then raise exception 'Question not found'; end if;
  end if;
  return v_id;
end;
$$;

-- ─────────────────────────────────────────────
-- D. Student: my courses, content, reading progress
-- ─────────────────────────────────────────────
create or replace function my_courses()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  return coalesce((
    select jsonb_agg(x order by x.code) from (
      select c.id, c.code, c.title, c.year, d.name as department, pr.name as teacher_name,
        (select count(*) from course_roster(c.id)) as member_count,
        (select min(e.event_date) from course_events e where e.course_id = c.id and e.kind = 'exam' and e.event_date >= current_date) as next_exam,
        (select count(*) from course_topics t where t.course_id = c.id) as topic_count,
        (select count(*) from course_topic_progress g where g.course_id = c.id and g.profile_id = auth.uid()) as topics_done
      from courses c
      join departments d on d.id = c.department_id
      join profiles pr on pr.id = c.created_by
      where is_course_member(c.id)
    ) x), '[]'::jsonb);
end;
$$;

create or replace function get_course_content(p_course_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_staff boolean; v_done uuid[]; v_complete boolean;
begin
  v_staff := is_course_staff(p_course_id);
  if not (v_staff or is_course_member(p_course_id)) then raise exception 'Not authorized'; end if;
  select coalesce(array_agg(topic_id), '{}') into v_done from course_topic_progress where course_id = p_course_id and profile_id = auth.uid();
  v_complete := course_completed(p_course_id, auth.uid());
  return jsonb_build_object(
    'course', (select jsonb_build_object('id', c.id, 'code', c.code, 'title', c.title, 'year', c.year, 'department', d.name)
               from courses c join departments d on d.id = c.department_id where c.id = p_course_id),
    'topics', coalesce((select jsonb_agg(t order by t.position, t.created_at) from (
        select id, title, summary, position, created_at from course_topics where course_id = p_course_id) t), '[]'::jsonb),
    'materials', coalesce((select jsonb_agg(m order by m.created_at) from (
        select id, topic, topic_id, title, kind, body, file_name, file_size, mime, created_at
        from course_materials where course_id = p_course_id order by created_at limit 500) m), '[]'::jsonb),
    -- Students only receive PRACTICE questions, and only for topics they have finished. Daily and assessment
    -- questions never leave the server with their answers.
    'questions', coalesce((select jsonb_agg(q order by q.created_at) from (
        select id, topic, topic_id, purpose, question, options, correct_index, explanation, created_at
        from course_questions
        where course_id = p_course_id
          and (v_staff or (purpose = 'practice' and ((topic_id is not null and topic_id = any (v_done)) or (topic_id is null and v_complete))))
        order by created_at limit 800) q), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(e order by e.created_at desc) from (
        select id, kind, title, body, event_date, created_at from course_events where course_id = p_course_id order by created_at desc limit 50) e), '[]'::jsonb),
    'progress', jsonb_build_object(
      'read_material_ids', coalesce((select jsonb_agg(material_id) from course_material_reads where course_id = p_course_id and profile_id = auth.uid()), '[]'::jsonb),
      'completed_topic_ids', to_jsonb(v_done),
      'course_complete', v_complete)
  );
end;
$$;

create or replace function mark_material_read(p_material_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_course uuid;
begin
  select course_id into v_course from course_materials where id = p_material_id;
  if v_course is null or not is_course_member(v_course) then raise exception 'Resource not found'; end if;
  insert into course_material_reads (material_id, profile_id, course_id) values (p_material_id, auth.uid(), v_course) on conflict do nothing;
end;
$$;

create or replace function complete_topic(p_topic_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_t course_topics; v_left int;
begin
  select * into v_t from course_topics where id = p_topic_id;
  if not found or not is_course_member(v_t.course_id) then raise exception 'Topic not found'; end if;
  select count(*) into v_left from course_materials m
   where m.topic_id = p_topic_id
     and not exists (select 1 from course_material_reads r where r.material_id = m.id and r.profile_id = auth.uid());
  if v_left > 0 then raise exception 'Open every resource in this topic first (% left)', v_left; end if;
  insert into course_topic_progress (topic_id, profile_id, course_id) values (p_topic_id, auth.uid(), v_t.course_id) on conflict do nothing;
  return jsonb_build_object('course_complete', course_completed(v_t.course_id, auth.uid()));
end;
$$;

-- ─────────────────────────────────────────────
-- E. Daily quizzes (per course)
-- ─────────────────────────────────────────────
-- Up to 5 questions a day, random, from daily questions the student hasn't answered, restricted to topics they have
-- started reading (or topic-less questions). pending_total says how many are still waiting, so the app can say
-- "read more to unlock".
create or replace function course_daily_quiz(p_course_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_today int; v_pending int;
begin
  if not is_course_member(p_course_id) then raise exception 'Not authorized'; end if;
  select count(*) into v_today from course_daily_answers where profile_id = auth.uid() and course_id = p_course_id and answered_on = current_date;
  select count(*) into v_pending from course_questions q
   where q.course_id = p_course_id and q.purpose = 'daily'
     and not exists (select 1 from course_daily_answers a where a.question_id = q.id and a.profile_id = auth.uid());
  return jsonb_build_object(
    'answered_today', v_today, 'daily_limit', 5, 'pending_total', v_pending,
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'topic', x.topic, 'question', x.question, 'options', to_jsonb(x.options)))
      from (
        select q.id, q.topic, q.question, q.options from course_questions q
         where q.course_id = p_course_id and q.purpose = 'daily'
           and not exists (select 1 from course_daily_answers a where a.question_id = q.id and a.profile_id = auth.uid())
           and (q.topic_id is null or exists (
                 select 1 from course_material_reads r join course_materials m on m.id = r.material_id
                  where r.profile_id = auth.uid() and m.topic_id = q.topic_id))
         order by random() limit greatest(0, 5 - v_today)) x), '[]'::jsonb));
end;
$$;

-- First answer only. 10 points when right, added to the leaderboard total.
create or replace function submit_course_daily_answer(p_question_id uuid, p_picked int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_q course_questions; v_prev course_daily_answers; v_ok boolean; v_pts int := 0; v_total int; v_today int;
begin
  select * into v_q from course_questions where id = p_question_id and purpose = 'daily';
  if not found or not is_course_member(v_q.course_id) then raise exception 'Question not found'; end if;
  if p_picked is null or p_picked not between 0 and 3 then raise exception 'Pick one of the four options'; end if;
  select * into v_prev from course_daily_answers where question_id = p_question_id and profile_id = auth.uid();
  if found then
    return jsonb_build_object('already_answered', true, 'is_correct', v_prev.correct, 'correct_index', v_q.correct_index,
                              'explanation', v_q.explanation, 'points_earned', 0);
  end if;
  select count(*) into v_today from course_daily_answers where profile_id = auth.uid() and course_id = v_q.course_id and answered_on = current_date;
  if v_today >= 5 then raise exception 'You have finished today''s quiz for this course. Come back tomorrow'; end if;
  v_ok := (p_picked = v_q.correct_index);
  insert into course_daily_answers (question_id, profile_id, course_id, picked, correct) values (p_question_id, auth.uid(), v_q.course_id, p_picked, v_ok);
  if v_ok then
    v_pts := 10;
    update profiles set total_points = total_points + v_pts where id = auth.uid() returning total_points into v_total;
  end if;
  return jsonb_build_object('already_answered', false, 'is_correct', v_ok, 'correct_index', v_q.correct_index,
                            'explanation', v_q.explanation, 'points_earned', v_pts, 'total_points', v_total);
end;
$$;

-- ─────────────────────────────────────────────
-- F. Assessments: practical | test | exam
-- ─────────────────────────────────────────────
alter table course_exams add column if not exists kind text not null default 'exam';
alter table course_exams drop constraint if exists course_exams_kind_check;
alter table course_exams add constraint course_exams_kind_check check (kind in ('practical', 'test', 'exam'));

create or replace function exam_points_per_question(p_kind text) returns int
language sql immutable as $$ select case p_kind when 'exam' then 20 when 'test' then 15 else 10 end; $$;

drop function if exists staff_create_exam(uuid, text, uuid[], timestamptz, timestamptz, int);
create or replace function staff_create_exam(
  p_course_id uuid, p_title text, p_question_ids uuid[],
  p_starts_at timestamptz, p_ends_at timestamptz, p_duration_minutes int, p_kind text default 'exam'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_snapshot jsonb; v_event uuid; v_exam uuid; v_found int; v_label text;
begin
  if not is_course_staff(p_course_id) then raise exception 'Not authorized'; end if;
  if p_kind not in ('practical', 'test', 'exam') then raise exception 'Choose practical, test or exam'; end if;
  if p_question_ids is null or array_length(p_question_ids, 1) not between 3 and 60 then raise exception 'It needs 3 to 60 questions'; end if;
  if (select count(distinct x) from unnest(p_question_ids) x) <> array_length(p_question_ids, 1) then raise exception 'Duplicate questions'; end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then raise exception 'It must end after it starts'; end if;
  if p_ends_at <= now() then raise exception 'That window is already over'; end if;
  if p_duration_minutes is null or p_duration_minutes not between 5 and 240 then raise exception 'Duration must be 5 to 240 minutes'; end if;
  if (select count(*) from course_exams where course_id = p_course_id) >= 50 then raise exception 'Too many assessments. Delete an old one first'; end if;

  select jsonb_agg(jsonb_build_object('id', q.id, 'q', q.question, 'topic', q.topic, 'options', to_jsonb(q.options),
                                      'correct', q.correct_index, 'explanation', q.explanation) order by u.n), count(*)
    into v_snapshot, v_found
    from unnest(p_question_ids) with ordinality as u(id, n)
    join course_questions q on q.id = u.id and q.course_id = p_course_id;
  if v_found <> array_length(p_question_ids, 1) then raise exception 'Some questions do not belong to this course'; end if;

  v_label := initcap(p_kind);
  insert into course_events (course_id, kind, title, body, event_date, created_by)
  values (p_course_id, 'exam', left(v_label || ': ' || trim(p_title), 120),
          format('Opens %s, closes %s (UTC). %s minutes once you start; one attempt.%s',
                 to_char(p_starts_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI'), to_char(p_ends_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI'),
                 p_duration_minutes, case when p_kind <> 'practical' then ' Finish every topic first.' else '' end),
          (p_starts_at at time zone 'UTC')::date, auth.uid())
  returning id into v_event;

  insert into course_exams (course_id, kind, title, questions, starts_at, ends_at, duration_minutes, event_id, created_by)
  values (p_course_id, p_kind, trim(p_title), v_snapshot, p_starts_at, p_ends_at, p_duration_minutes, v_event, auth.uid())
  returning id into v_exam;
  return jsonb_build_object('exam_id', v_exam, 'event_id', v_event);
end;
$$;

create or replace function list_course_exams(p_course_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_staff boolean; v_done boolean;
begin
  v_staff := is_course_staff(p_course_id);
  if not (v_staff or is_course_member(p_course_id)) then raise exception 'Not authorized'; end if;
  v_done := course_completed(p_course_id, auth.uid());
  return coalesce((
    select jsonb_agg(x order by x.starts_at desc) from (
      select e.id, e.title, e.kind, e.starts_at, e.ends_at, e.duration_minutes,
        jsonb_array_length(e.questions) as question_count,
        case when now() < e.starts_at then 'upcoming' when now() <= e.ends_at then 'open' else 'closed' end as status,
        (not v_staff and e.kind <> 'practical' and not v_done) as locked,
        (select jsonb_build_object('started_at', a.started_at, 'submitted', a.submitted_at is not null, 'correct', a.correct, 'total', a.total)
           from course_exam_attempts a where a.exam_id = e.id and a.profile_id = auth.uid()) as my_attempt,
        case when v_staff then (select count(*) from course_exam_attempts a where a.exam_id = e.id and a.submitted_at is not null) end as submitted_count
      from course_exams e where e.course_id = p_course_id order by e.starts_at desc limit 50
    ) x), '[]'::jsonb);
end;
$$;

create or replace function start_course_exam(p_exam_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_exam course_exams; v_att course_exam_attempts; v_deadline timestamptz;
begin
  select * into v_exam from course_exams where id = p_exam_id;
  if not found or not is_course_member(v_exam.course_id) then raise exception 'Not found'; end if;
  if v_exam.kind <> 'practical' and not course_completed(v_exam.course_id, auth.uid()) then
    raise exception 'Finish every topic in this course to unlock the %', v_exam.kind;
  end if;
  if now() < v_exam.starts_at then raise exception 'This has not opened yet'; end if;
  select * into v_att from course_exam_attempts where exam_id = p_exam_id and profile_id = auth.uid();
  if not found then
    if now() >= v_exam.ends_at then raise exception 'This has closed'; end if;
    insert into course_exam_attempts (exam_id, profile_id) values (p_exam_id, auth.uid()) on conflict do nothing;
    select * into v_att from course_exam_attempts where exam_id = p_exam_id and profile_id = auth.uid();
  end if;
  if v_att.submitted_at is not null then raise exception 'You have already submitted this'; end if;
  v_deadline := least(v_att.started_at + make_interval(mins => v_exam.duration_minutes), v_exam.ends_at);
  if now() > v_deadline then raise exception 'Time is up'; end if;
  return jsonb_build_object('exam_id', v_exam.id, 'title', v_exam.title, 'kind', v_exam.kind, 'server_now', now(),
    'started_at', v_att.started_at, 'deadline', v_deadline,
    'questions', (select jsonb_agg(jsonb_build_object('q', e->>'q', 'options', e->'options') order by n)
                  from jsonb_array_elements(v_exam.questions) with ordinality as t(e, n)));
end;
$$;

-- Same grading as 021, plus: the first (only) score is added to the leaderboard total.
create or replace function submit_course_exam(p_exam_id uuid, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_exam course_exams; v_att course_exam_attempts; v_deadline timestamptz; v_total int; v_correct int; v_pts int; v_new_total int;
begin
  select * into v_exam from course_exams where id = p_exam_id;
  if not found or not is_course_member(v_exam.course_id) then raise exception 'Not found'; end if;
  select * into v_att from course_exam_attempts where exam_id = p_exam_id and profile_id = auth.uid() for update;
  if not found then raise exception 'Start it first'; end if;
  if v_att.submitted_at is not null then raise exception 'You have already submitted this'; end if;
  v_deadline := least(v_att.started_at + make_interval(mins => v_exam.duration_minutes), v_exam.ends_at);
  if now() > v_deadline + interval '60 seconds' then raise exception 'Time was up, so this attempt was not recorded'; end if;
  v_total := jsonb_array_length(v_exam.questions);
  if jsonb_typeof(p_answers) is distinct from 'array' or jsonb_array_length(p_answers) <> v_total then raise exception 'Answers do not match'; end if;
  select count(*) into v_correct from jsonb_array_elements(v_exam.questions) with ordinality as t(e, n)
   where (p_answers -> (n::int - 1))::text = (e->>'correct');
  update course_exam_attempts set submitted_at = now(), answers = p_answers, correct = v_correct, total = v_total
   where exam_id = p_exam_id and profile_id = auth.uid();
  v_pts := v_correct * exam_points_per_question(v_exam.kind);
  update profiles set total_points = total_points + v_pts where id = auth.uid() returning total_points into v_new_total;
  return jsonb_build_object('correct', v_correct, 'total', v_total, 'points_earned', v_pts, 'total_points', v_new_total);
end;
$$;

-- Review is open to the student as soon as they have submitted (or once the window closes), and to staff always.
create or replace function review_course_exam(p_exam_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_exam course_exams; v_mine jsonb; v_submitted boolean;
begin
  select * into v_exam from course_exams where id = p_exam_id;
  if not found or not (is_course_member(v_exam.course_id) or is_course_staff(v_exam.course_id)) then raise exception 'Not found'; end if;
  select answers, (submitted_at is not null) into v_mine, v_submitted from course_exam_attempts where exam_id = p_exam_id and profile_id = auth.uid();
  if not (is_course_staff(v_exam.course_id) or coalesce(v_submitted, false) or now() > v_exam.ends_at) then
    raise exception 'Submit your attempt to see the answers';
  end if;
  return (select jsonb_agg(jsonb_build_object('q', e->>'q', 'options', e->'options', 'correct', (e->>'correct')::int,
                 'explanation', e->>'explanation', 'picked', v_mine -> (n::int - 1)) order by n)
          from jsonb_array_elements(v_exam.questions) with ordinality as t(e, n));
end;
$$;

create or replace function staff_exam_results(p_exam_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_exam course_exams;
begin
  select * into v_exam from course_exams where id = p_exam_id;
  if not found or not is_course_staff(v_exam.course_id) then raise exception 'Not found'; end if;
  return jsonb_build_object('title', v_exam.title, 'kind', v_exam.kind, 'total', jsonb_array_length(v_exam.questions),
    'students', coalesce((
      select jsonb_agg(s order by s.correct desc nulls last, s.name) from (
        select pr.name, (a.submitted_at is not null) as submitted, (a.profile_id is not null) as started, coalesce(a.correct, 0) as correct,
               case when a.submitted_at is not null then extract(epoch from (a.submitted_at - a.started_at))::int end as seconds
        from course_roster(v_exam.course_id) r
        join profiles pr on pr.id = r
        left join course_exam_attempts a on a.exam_id = p_exam_id and a.profile_id = r
      ) s), '[]'::jsonb),
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object('q', k.q, 'attempts', k.attempts, 'pct_correct',
               case when k.attempts > 0 then round(100.0 * k.right_count / k.attempts) end) order by k.n)
      from (
        select t.n, t.e->>'q' as q, count(a.profile_id) as attempts,
               count(*) filter (where (a.answers -> (t.n::int - 1))::text = (t.e->>'correct')) as right_count
        from jsonb_array_elements(v_exam.questions) with ordinality as t(e, n)
        left join course_exam_attempts a on a.exam_id = p_exam_id and a.submitted_at is not null
        group by t.n, t.e) k), '[]'::jsonb));
end;
$$;

-- ─────────────────────────────────────────────
-- G. Class ranking + teacher progress view
-- ─────────────────────────────────────────────
-- Points earned in THIS course from first answers to daily questions and first (only) assessment attempts.
create or replace function course_leaderboard(p_course_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not (is_course_member(p_course_id) or is_course_staff(p_course_id)) then raise exception 'Not authorized'; end if;
  return (
    with pts as (
      select pr.id, pr.name,
        coalesce((select count(*) filter (where a.correct) * 10 from course_daily_answers a where a.course_id = p_course_id and a.profile_id = pr.id), 0)
        + coalesce((select sum(att.correct * exam_points_per_question(e.kind)) from course_exam_attempts att join course_exams e on e.id = att.exam_id
                     where e.course_id = p_course_id and att.profile_id = pr.id and att.submitted_at is not null), 0) as points
      from course_roster(p_course_id) r join profiles pr on pr.id = r
    ), ranked as (
      select id, name, points, rank() over (order by points desc) as rnk from pts
    )
    select jsonb_build_object(
      'top', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'points', points, 'rank', rnk) order by rnk, name)
                       from (select * from ranked order by rnk, name limit 20) t), '[]'::jsonb),
      'me', (select jsonb_build_object('rank', rnk, 'points', points) from ranked where id = auth.uid()),
      'size', (select count(*) from ranked))
  );
end;
$$;

-- Teacher: how far each student is through the topics.
create or replace function staff_topic_progress(p_course_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_course_staff(p_course_id) then raise exception 'Not authorized'; end if;
  return jsonb_build_object(
    'topic_count', (select count(*) from course_topics where course_id = p_course_id),
    'students', coalesce((
      select jsonb_agg(s order by s.done desc, s.name) from (
        select pr.name,
               (select count(*) from course_topic_progress g where g.course_id = p_course_id and g.profile_id = r) as done
        from course_roster(p_course_id) r join profiles pr on pr.id = r) s), '[]'::jsonb));
end;
$$;

-- Class size on the teacher dashboard now counts the whole department + year roster.
create or replace function teacher_course_stats(p_course_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_course_staff(p_course_id) then raise exception 'Not authorized'; end if;
  return jsonb_build_object(
    'member_count', (select count(*) from course_roster(p_course_id)),
    'active_7d', (select count(distinct profile_id) from course_answer_events where course_id = p_course_id and created_at > now() - interval '7 days'),
    'answers_total', (select count(*) from course_answer_events where course_id = p_course_id),
    'accuracy', (select round(100.0 * avg(correct::int)) from course_answer_events where course_id = p_course_id),
    'hardest', coalesce((
      select jsonb_agg(h order by h.pct_correct) from (
        select q.id as question_id, q.question, q.topic, count(*) as attempts, round(100.0 * avg(e.correct::int)) as pct_correct
        from course_questions q join course_answer_events e on e.question_id = q.id
        where q.course_id = p_course_id group by q.id having count(*) >= 3 order by pct_correct asc limit 5) h), '[]'::jsonb),
    'topics', coalesce((
      select jsonb_agg(t order by t.pct_correct) from (
        select case when q.topic = '' then 'General' else q.topic end as topic, count(*) as attempts, round(100.0 * avg(e.correct::int)) as pct_correct
        from course_questions q join course_answer_events e on e.question_id = q.id
        where q.course_id = p_course_id group by 1 order by pct_correct asc limit 12) t), '[]'::jsonb),
    'students', coalesce((
      select jsonb_agg(s order by s.accuracy) from (
        select pr.name, count(*) as answers, round(100.0 * avg(e.correct::int)) as accuracy
        from course_answer_events e join profiles pr on pr.id = e.profile_id
        where e.course_id = p_course_id group by pr.id, pr.name order by accuracy asc limit 100) s), '[]'::jsonb));
end;
$$;

-- ─────────────────────────────────────────────
-- H. Grants (same convention as 017/022)
-- ─────────────────────────────────────────────
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (array[
      'create_course', 'staff_list_courses', 'staff_save_topic', 'staff_delete_topic', 'staff_move_topic', 'staff_save_material',
      'staff_add_file_to_topic', 'staff_save_question', 'my_courses', 'get_course_content', 'mark_material_read', 'complete_topic',
      'course_daily_quiz', 'submit_course_daily_answer', 'staff_create_exam', 'list_course_exams', 'start_course_exam',
      'submit_course_exam', 'review_course_exam', 'staff_exam_results', 'course_leaderboard', 'staff_topic_progress',
      'teacher_course_stats', 'admin_set_teacher_years', 'admin_get_teacher_years'
    ])
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
  -- internal helpers: only other security-definer functions call these
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (array['course_roster', 'course_completed', 'exam_points_per_question'])
  loop
    execute format('revoke all on function %s from public', r.sig);
  end loop;
end;
$$;
