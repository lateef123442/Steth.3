-- Blocking + reporting, chat suspension, a feedback inbox for admins, teachers in several departments,
-- and admin deletion of accounts.  Run after 026_social_chat_avatars.sql.  NOT yet executed: test on staging first.
--
--  1. Blocking: either side's block stops friend requests, private messages and group adds in both directions,
--     removes the friendship, and hides the blocked person from search and chat lists. In a group chat you
--     simply stop seeing messages from people you blocked.
--  2. Reporting: a user can report a person (optionally a specific message they received or can see in a group).
--     The message text is COPIED into the report, so it survives the sender deleting or the message changing.
--     Admins review, add a note, resolve or dismiss, and can suspend someone's chat for 1-365 days.
--  3. Feedback: any signed-in user sends a complaint / bug / suggestion; admins reply and set a status; the sender
--     sees the reply live. Rate limited to 5 per day.
--  4. Teachers can be assigned to several departments (profiles.department_id stays their primary one).
--  5. Admins can delete a teacher's (or student's) account. For teachers the courses are either transferred to the
--     admin doing the deletion (default: students keep their progress and rankings) or deleted with them.
--  6. friendships, feedback and reports join the realtime publication so requests, replies and the admin inbox
--     update live. Row-level security decides who receives each row.

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

-- ─────────────────────────────────────────────
-- A. Teachers in several departments
-- ─────────────────────────────────────────────
create table if not exists teacher_departments (
  teacher_id uuid not null references profiles (id) on delete cascade,
  department_id uuid not null references departments (id) on delete cascade,
  primary key (teacher_id, department_id)
);
alter table teacher_departments enable row level security; -- functions only
insert into teacher_departments (teacher_id, department_id)
select id, department_id from profiles where role = 'teacher' and department_id is not null on conflict do nothing;

create or replace function teaches_department(p_user uuid, p_dept uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from teacher_departments where teacher_id = p_user and department_id = p_dept)
      or exists (select 1 from profiles where id = p_user and department_id = p_dept);
$$;

create or replace function my_teaching_departments() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) order by d.name) from departments d
    where teaches_department(auth.uid(), d.id)), '[]'::jsonb);
end;
$$;

create or replace function admin_get_teacher_departments(p_teacher uuid) returns uuid[]
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  return coalesce((select array_agg(d.id) from departments d where teaches_department(p_teacher, d.id)), '{}');
end;
$$;

-- Replaces the teacher's departments. The primary department (profiles.department_id) stays if still listed,
-- otherwise the first one becomes primary.
create or replace function admin_set_teacher_departments(p_teacher uuid, p_departments uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare v_primary uuid; v_ids uuid[];
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  if not exists (select 1 from profiles where id = p_teacher and role = 'teacher') then raise exception 'That user is not a teacher'; end if;
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(coalesce(p_departments, '{}')) x;
  if coalesce(array_length(v_ids, 1), 0) = 0 then raise exception 'Choose at least one department'; end if;
  if (select count(*) from departments where id = any (v_ids)) <> array_length(v_ids, 1) then raise exception 'Unknown department'; end if;
  select department_id into v_primary from profiles where id = p_teacher;
  delete from teacher_departments where teacher_id = p_teacher;
  insert into teacher_departments (teacher_id, department_id) select p_teacher, x from unnest(v_ids) x;
  update profiles set department_id = case when v_primary = any (v_ids) then v_primary else (p_departments[1]) end where id = p_teacher;
end;
$$;

create or replace function create_course(p_department_id uuid, p_code text, p_title text, p_year int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_role text; v_years int[]; v_row courses;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select role, teaching_years into v_role, v_years from profiles where id = v_uid;
  if v_role not in ('teacher', 'admin') then raise exception 'Not authorized'; end if;
  if p_year is null or p_year not between 1 and 7 then raise exception 'Choose the year (level) this course is for'; end if;
  if v_role = 'teacher' then
    if not teaches_department(v_uid, p_department_id) then raise exception 'You are not assigned to that department'; end if;
    if coalesce(array_length(v_years, 1), 0) > 0 and not (p_year = any (v_years)) then raise exception 'You are not assigned to Year %. Ask an admin to assign it.', p_year; end if;
  end if;
  if char_length(trim(p_code)) < 2 or char_length(trim(p_title)) < 2 then raise exception 'Course code and title are required'; end if;
  insert into courses (department_id, year, code, title, created_by) values (p_department_id, p_year, upper(trim(p_code)), trim(p_title), v_uid) returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'join_code', v_row.join_code);
end;
$$;

drop function if exists create_year_group(text, text, int);
create or replace function create_year_group(p_department_id uuid, p_name text, p_description text, p_year int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_role text; v_years int[]; v_row study_groups; v_added int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select role, teaching_years into v_role, v_years from profiles where id = v_uid;
  if v_role is distinct from 'teacher' or not teaches_department(v_uid, p_department_id) then raise exception 'Only a teacher of that department can create its class groups'; end if;
  if p_year is null or p_year not between 1 and 7 then raise exception 'Choose a year'; end if;
  if coalesce(array_length(v_years, 1), 0) > 0 and not (p_year = any (v_years)) then raise exception 'You are not assigned to Year %', p_year; end if;
  if char_length(trim(p_name)) < 2 then raise exception 'Give the group a name'; end if;
  if (select count(*) from study_groups where owner_id = v_uid and official) >= 40 then raise exception 'You can run up to 40 class groups'; end if;
  insert into study_groups (department_id, year, official, name, description, owner_id)
  values (p_department_id, p_year, true, trim(p_name), coalesce(trim(p_description), ''), v_uid) returning * into v_row;
  insert into group_members (group_id, profile_id) values (v_row.id, v_uid);
  insert into group_members (group_id, profile_id)
  select v_row.id, p.id from profiles p where p.role = 'student' and p.department_id = p_department_id and p.year = p_year on conflict do nothing;
  get diagnostics v_added = row_count;
  return jsonb_build_object('id', v_row.id, 'join_code', v_row.join_code, 'students_added', v_added);
end;
$$;

create or replace function teacher_department_stats(p_department_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select role into v_role from profiles where id = auth.uid();
  if v_role not in ('teacher', 'admin') then raise exception 'Not authorized'; end if;
  if v_role = 'teacher' and not teaches_department(auth.uid(), p_department_id) then raise exception 'Not authorized for this department'; end if;
  return jsonb_build_object(
    'student_count', (select count(*) from profiles where department_id = p_department_id and role = 'student'),
    'avg_points', coalesce((select round(avg(total_points), 1) from profiles where department_id = p_department_id and role = 'student'), 0),
    'today_question_count', (select count(*) from quiz_questions where department_id = p_department_id and quiz_date = current_date),
    'today_completions', (select count(distinct qa.profile_id) from quiz_attempts qa join quiz_questions qq on qq.id = qa.question_id
                           where qq.department_id = p_department_id and qq.quiz_date = current_date));
end;
$$;

-- ─────────────────────────────────────────────
-- B. Admin: delete an account
-- ─────────────────────────────────────────────
-- p_courses: 'transfer' (default) hands the teacher's courses and everything in them to the admin doing this, so
-- students keep their progress and rankings; 'delete' removes the courses with the teacher.
-- Admins can't delete themselves or other admins (demote first). The teacher's own study groups go with them.
create or replace function admin_delete_user(p_user uuid, p_courses text default 'transfer') returns void
language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  if p_user = auth.uid() then raise exception 'You can''t delete your own account here'; end if;
  select role into v_role from profiles where id = p_user;
  if v_role is null then raise exception 'User not found'; end if;
  if v_role = 'admin' then raise exception 'Change this admin to another role before deleting them'; end if;
  if p_courses not in ('transfer', 'delete') then raise exception 'Choose transfer or delete'; end if;
  if v_role = 'teacher' then
    if p_courses = 'delete' then
      delete from courses where created_by = p_user;
    else
      update courses set created_by = auth.uid() where created_by = p_user;
    end if;
    update course_topics set created_by = auth.uid() where created_by = p_user;
    update course_materials set created_by = auth.uid() where created_by = p_user;
    update course_questions set created_by = auth.uid() where created_by = p_user;
    update course_events set created_by = auth.uid() where created_by = p_user;
    update course_exams set created_by = auth.uid() where created_by = p_user;
  end if;
  delete from auth.users where id = p_user; -- cascades to the profile and the person's own data
end;
$$;

-- ─────────────────────────────────────────────
-- C. Blocking + chat suspension
-- ─────────────────────────────────────────────
alter table profiles add column if not exists chat_suspended_until timestamptz;

create or replace function chat_allowed(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select chat_suspended_until is null or chat_suspended_until <= now() from profiles where id = p_user), false);
$$;

create table if not exists user_blocks (
  blocker uuid not null references profiles (id) on delete cascade,
  blocked uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
create index if not exists idx_user_blocks_blocked on user_blocks (blocked);
alter table user_blocks enable row level security; -- functions only

create or replace function is_blocked_between(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_blocks where (blocker = a and blocked = b) or (blocker = b and blocked = a));
$$;

create or replace function block_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_user = auth.uid() then raise exception 'You can''t block yourself'; end if;
  if not exists (select 1 from profiles where id = p_user) then raise exception 'User not found'; end if;
  insert into user_blocks (blocker, blocked) values (auth.uid(), p_user) on conflict do nothing;
  delete from friendships where (requester = auth.uid() and addressee = p_user) or (requester = p_user and addressee = auth.uid());
end;
$$;

create or replace function unblock_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  delete from user_blocks where blocker = auth.uid() and blocked = p_user;
end;
$$;

create or replace function my_blocks() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  return coalesce((
    select jsonb_agg(x order by x.name) from (
      select p.id, p.name, d.name as department, p.year, p.avatar_path
      from user_blocks b join profiles p on p.id = b.blocked left join departments d on d.id = p.department_id
      where b.blocker = auth.uid()) x), '[]'::jsonb);
end;
$$;

-- 026 functions, now block- and suspension-aware.
create or replace function search_people(p_query text, p_limit int default 20) returns jsonb
language plpgsql security definer set search_path = public as $$
declare q text := trim(coalesce(p_query, '')); v_dept uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if char_length(q) < 2 then return '[]'::jsonb; end if;
  select department_id into v_dept from profiles where id = auth.uid();
  return coalesce((
    select jsonb_agg(x) from (
      select p.id, p.name, d.name as department, p.year, p.university, p.avatar_path,
        case when f.status = 'accepted' then 'friend'
             when f.status = 'pending' and f.requester = auth.uid() then 'sent'
             when f.status = 'pending' then 'received' else 'none' end as relation
      from profiles p
      left join departments d on d.id = p.department_id
      left join friendships f on (f.requester = auth.uid() and f.addressee = p.id) or (f.addressee = auth.uid() and f.requester = p.id)
      where p.role = 'student' and p.id <> auth.uid() and not is_blocked_between(auth.uid(), p.id)
        and p.name ilike '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      order by (p.department_id is not distinct from v_dept) desc, p.name
      limit least(greatest(coalesce(p_limit, 20), 1), 30)
    ) x), '[]'::jsonb);
end;
$$;

create or replace function send_friend_request(p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_f friendships;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  if p_user = v_me then raise exception 'You can''t add yourself'; end if;
  if not chat_allowed(v_me) then raise exception 'Your messaging is paused by an admin'; end if;
  if (select role from profiles where id = v_me) is distinct from 'student' or (select role from profiles where id = p_user) is distinct from 'student' then
    raise exception 'Friends are student to student';
  end if;
  if is_blocked_between(v_me, p_user) then raise exception 'You can''t send a request to this person'; end if;
  select * into v_f from friendships where (requester = v_me and addressee = p_user) or (requester = p_user and addressee = v_me);
  if found then
    if v_f.status = 'accepted' then return 'friend'; end if;
    if v_f.requester = p_user then
      update friendships set status = 'accepted', responded_at = now() where requester = p_user and addressee = v_me;
      return 'friend';
    end if;
    return 'sent';
  end if;
  if (select count(*) from friendships where requester = v_me and status = 'pending') >= 100 then raise exception 'You have too many pending requests'; end if;
  insert into friendships (requester, addressee) values (v_me, p_user);
  return 'sent';
end;
$$;

create or replace function send_direct_message(p_to uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_row direct_messages;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  if not chat_allowed(v_me) then raise exception 'Your messaging is paused by an admin'; end if;
  if is_blocked_between(v_me, p_to) then raise exception 'You can''t message this person'; end if;
  if not are_friends(v_me, p_to) then raise exception 'You can only message friends'; end if;
  if (select count(*) from direct_messages where sender_id = v_me and created_at > now() - interval '1 minute') >= 30 then raise exception 'Slow down a little'; end if;
  insert into direct_messages (sender_id, recipient_id, body) values (v_me, p_to, trim(p_body)) returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'sender_id', v_row.sender_id, 'recipient_id', v_row.recipient_id, 'body', v_row.body, 'created_at', v_row.created_at);
end;
$$;

create or replace function send_group_message(p_group_id uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_row group_messages;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  if not chat_allowed(v_me) then raise exception 'Your messaging is paused by an admin'; end if;
  if not is_group_member(p_group_id) then raise exception 'Not a member of this group'; end if;
  if (select count(*) from group_messages where author_id = v_me and created_at > now() - interval '1 minute') >= 30 then raise exception 'Slow down a little'; end if;
  insert into group_messages (group_id, author_id, body) values (p_group_id, v_me, trim(p_body)) returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'group_id', v_row.group_id, 'author_id', v_row.author_id, 'body', v_row.body, 'created_at', v_row.created_at);
end;
$$;

-- You no longer see messages from people you blocked.
create or replace function list_group_messages(p_group_id uuid, p_before timestamptz default null, p_limit int default 40) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_group_member(p_group_id) then raise exception 'Not a member of this group'; end if;
  return coalesce((
    select jsonb_agg(x order by x.created_at desc) from (
      select m.id, m.author_id, pr.name as author_name, pr.avatar_path, m.body, m.created_at
      from group_messages m join profiles pr on pr.id = m.author_id
      where m.group_id = p_group_id and (p_before is null or m.created_at < p_before)
        and not exists (select 1 from user_blocks b where b.blocker = auth.uid() and b.blocked = m.author_id)
      order by m.created_at desc limit least(greatest(coalesce(p_limit, 40), 1), 100)
    ) x), '[]'::jsonb);
end;
$$;

create or replace function my_conversations() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  return coalesce((
    select jsonb_agg(x order by x.last_at desc) from (
      select p.id, p.name, d.name as department, p.year, p.avatar_path, l.body as last_body, l.created_at as last_at, l.sender_id = v_me as last_mine,
        (select count(*) from direct_messages u where u.recipient_id = v_me and u.sender_id = p.id and u.read_at is null) as unread
      from (select distinct on (other) other, id from (
              select case when sender_id = v_me then recipient_id else sender_id end as other, id, created_at
              from direct_messages where v_me in (sender_id, recipient_id)) z order by other, created_at desc) lm
      join direct_messages l on l.id = lm.id
      join profiles p on p.id = lm.other
      left join departments d on d.id = p.department_id
      where not is_blocked_between(v_me, p.id)
    ) x), '[]'::jsonb);
end;
$$;

create or replace function add_group_member(p_group_id uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_me profiles; v_t profiles;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not chat_allowed(auth.uid()) then raise exception 'Your messaging is paused by an admin'; end if;
  if not is_group_member(p_group_id) then raise exception 'Not a member of this group'; end if;
  select * into v_me from profiles where id = auth.uid();
  select * into v_t from profiles where id = p_user;
  if not found or v_t.role <> 'student' then raise exception 'You can only add students'; end if;
  if is_blocked_between(v_me.id, v_t.id) then raise exception 'You can''t add this person'; end if;
  if not (are_friends(v_me.id, v_t.id)
          or (v_t.department_id is not distinct from v_me.department_id and (v_me.role = 'teacher' or v_t.year is not distinct from v_me.year))) then
    raise exception 'Add them as a friend first, or pick someone from your own department and year';
  end if;
  if (select count(*) from group_members where group_id = p_group_id) >= 500 then raise exception 'This group is full'; end if;
  insert into group_members (group_id, profile_id) values (p_group_id, p_user) on conflict do nothing;
end;
$$;

-- ─────────────────────────────────────────────
-- D. Reports
-- ─────────────────────────────────────────────
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references profiles (id) on delete set null,
  reported_id uuid references profiles (id) on delete set null,
  reporter_name text not null default '',
  reported_name text not null default '',
  context text not null check (context in ('direct', 'group', 'profile')),
  message_id uuid,
  group_id uuid references study_groups (id) on delete set null,
  snippet text not null default '' check (char_length(snippet) <= 2000),
  reason text not null check (reason in ('harassment', 'spam', 'inappropriate', 'hate', 'threat', 'other')),
  details text not null default '' check (char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  admin_note text not null default '' check (char_length(admin_note) <= 1000),
  handled_by uuid references profiles (id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_report_once on reports (reporter_id, message_id) where message_id is not null;
create index if not exists idx_reports_status on reports (status, created_at desc);
create index if not exists idx_reports_reported on reports (reported_id);
alter table reports enable row level security;
drop policy if exists "reports: admins read" on reports;
create policy "reports: admins read" on reports for select to authenticated using (is_admin());

create or replace function report_user(p_user uuid, p_context text, p_message_id uuid, p_reason text, p_details text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_snip text := ''; v_group uuid; v_id uuid; v_my_name text; v_their_name text;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  if p_user = v_me then raise exception 'You can''t report yourself'; end if;
  select name into v_their_name from profiles where id = p_user;
  if v_their_name is null then raise exception 'User not found'; end if;
  select name into v_my_name from profiles where id = v_me;
  if p_context not in ('direct', 'group', 'profile') then raise exception 'Unknown report type'; end if;
  if (select count(*) from reports where reporter_id = v_me and created_at > now() - interval '24 hours') >= 10 then raise exception 'You have sent a lot of reports today. An admin will review them'; end if;
  if p_context = 'direct' and p_message_id is not null then
    select left(body, 2000) into v_snip from direct_messages where id = p_message_id and sender_id = p_user and recipient_id = v_me;
    if v_snip is null then raise exception 'That message was not found'; end if;
  elsif p_context = 'group' and p_message_id is not null then
    select left(m.body, 2000), m.group_id into v_snip, v_group from group_messages m
     where m.id = p_message_id and m.author_id = p_user and is_group_member(m.group_id);
    if v_snip is null then raise exception 'That message was not found'; end if;
  end if;
  insert into reports (reporter_id, reported_id, reporter_name, reported_name, context, message_id, group_id, snippet, reason, details)
  values (v_me, p_user, coalesce(v_my_name, ''), v_their_name, p_context, p_message_id, v_group, coalesce(v_snip, ''), p_reason, left(coalesce(trim(p_details), ''), 1000))
  returning id into v_id;
  return v_id;
exception when unique_violation then raise exception 'You already reported that message';
end;
$$;

create or replace function admin_list_reports(p_status text default 'open', p_limit int default 60) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  return coalesce((
    select jsonb_agg(x order by x.created_at desc) from (
      select r.id, r.reporter_id, r.reported_id, r.reporter_name, r.reported_name, r.context, r.snippet, r.reason, r.details, r.status, r.admin_note, r.created_at,
        (select count(*) from reports o where o.reported_id = r.reported_id) as reports_against,
        (select p.chat_suspended_until from profiles p where p.id = r.reported_id) as suspended_until
      from reports r
      where p_status is null or p_status = 'all' or r.status = p_status
      order by r.created_at desc limit least(greatest(coalesce(p_limit, 60), 1), 200)
    ) x), '[]'::jsonb);
end;
$$;

create or replace function admin_update_report(p_id uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  if p_status not in ('open', 'reviewing', 'resolved', 'dismissed') then raise exception 'Unknown status'; end if;
  update reports set status = p_status, admin_note = left(coalesce(trim(p_note), ''), 1000), handled_by = auth.uid(), handled_at = now() where id = p_id;
  if not found then raise exception 'Report not found'; end if;
end;
$$;

-- p_days = 0 lifts a suspension. Suspended people can't send messages, friend requests or group adds.
create or replace function admin_suspend_chat(p_user uuid, p_days int) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v_until timestamptz;
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  if (select role from profiles where id = p_user) = 'admin' then raise exception 'You can''t suspend an admin'; end if;
  if p_days is null or p_days < 0 or p_days > 365 then raise exception 'Choose 0 to 365 days'; end if;
  v_until := case when p_days = 0 then null else now() + make_interval(days => p_days) end;
  update profiles set chat_suspended_until = v_until where id = p_user;
  if not found then raise exception 'User not found'; end if;
  return v_until;
end;
$$;

-- ─────────────────────────────────────────────
-- E. Feedback inbox
-- ─────────────────────────────────────────────
create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references profiles (id) on delete cascade,
  category text not null check (category in ('complaint', 'bug', 'suggestion', 'other')),
  subject text not null check (char_length(trim(subject)) between 3 and 120),
  body text not null check (char_length(trim(body)) between 5 and 4000),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  admin_reply text not null default '' check (char_length(admin_reply) <= 2000),
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_feedback_author on feedback (author_id, created_at desc);
create index if not exists idx_feedback_status on feedback (status, created_at desc);
alter table feedback enable row level security;
drop policy if exists "feedback: own read" on feedback;
drop policy if exists "feedback: admins read" on feedback;
create policy "feedback: own read" on feedback for select to authenticated using (author_id = auth.uid());
create policy "feedback: admins read" on feedback for select to authenticated using (is_admin());

create or replace function submit_feedback(p_category text, p_subject text, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if (select count(*) from feedback where author_id = auth.uid() and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'You have sent 5 messages today. Please wait for a reply or try again tomorrow';
  end if;
  insert into feedback (author_id, category, subject, body) values (auth.uid(), p_category, trim(p_subject), trim(p_body)) returning id into v_id;
  return v_id;
end;
$$;

create or replace function my_feedback() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  return coalesce((
    select jsonb_agg(x order by x.created_at desc) from (
      select id, category, subject, body, status, admin_reply, replied_at, created_at from feedback
      where author_id = auth.uid() order by created_at desc limit 50) x), '[]'::jsonb);
end;
$$;

create or replace function admin_list_feedback(p_status text default null, p_limit int default 100) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  return coalesce((
    select jsonb_agg(x order by x.created_at desc) from (
      select f.id, f.category, f.subject, f.body, f.status, f.admin_reply, f.replied_at, f.created_at,
        pr.name as author_name, pr.role as author_role, d.name as department, pr.year, u.email
      from feedback f
      join profiles pr on pr.id = f.author_id
      left join departments d on d.id = pr.department_id
      left join auth.users u on u.id = f.author_id
      where p_status is null or p_status = 'all' or f.status = p_status
      order by f.created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 300)
    ) x), '[]'::jsonb);
end;
$$;

create or replace function admin_respond_feedback(p_id uuid, p_status text, p_reply text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  if p_status not in ('open', 'in_progress', 'resolved') then raise exception 'Unknown status'; end if;
  update feedback set status = p_status, updated_at = now(),
    admin_reply = case when char_length(trim(coalesce(p_reply, ''))) > 0 then left(trim(p_reply), 2000) else admin_reply end,
    replied_at = case when char_length(trim(coalesce(p_reply, ''))) > 0 then now() else replied_at end
  where id = p_id;
  if not found then raise exception 'Message not found'; end if;
end;
$$;

create or replace function admin_inbox_counts() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  return jsonb_build_object('feedback', (select count(*) from feedback where status = 'open'),
                            'reports', (select count(*) from reports where status = 'open'));
end;
$$;

-- ─────────────────────────────────────────────
-- F. Realtime for requests, replies and the admin inbox
-- ─────────────────────────────────────────────
drop policy if exists "friendships: own read" on friendships;
create policy "friendships: own read" on friendships for select to authenticated using (requester = auth.uid() or addressee = auth.uid());

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table friendships; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table feedback; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table reports; exception when duplicate_object then null; end;
  end if;
end;
$$;

-- ─────────────────────────────────────────────
-- G. Grants
-- ─────────────────────────────────────────────
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (array[
      'my_teaching_departments', 'admin_get_teacher_departments', 'admin_set_teacher_departments', 'create_course', 'create_year_group',
      'teacher_department_stats', 'admin_delete_user', 'block_user', 'unblock_user', 'my_blocks', 'search_people', 'send_friend_request',
      'send_direct_message', 'send_group_message', 'list_group_messages', 'my_conversations', 'add_group_member', 'report_user',
      'admin_list_reports', 'admin_update_report', 'admin_suspend_chat', 'submit_feedback', 'my_feedback', 'admin_list_feedback',
      'admin_respond_feedback', 'admin_inbox_counts'])
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
  -- policy helper is called from row-level security, so authenticated needs it; the rest are internal
  revoke all on function is_admin() from public; grant execute on function is_admin() to authenticated;
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (array['teaches_department', 'chat_allowed', 'is_blocked_between'])
  loop
    execute format('revoke all on function %s from public', r.sig);
  end loop;
end;
$$;
