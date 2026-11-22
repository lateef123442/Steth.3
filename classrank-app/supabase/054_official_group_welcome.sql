-- 054: automatically create one group for each course, enroll course members,
-- and send each student a private welcome note + in-app notification.

alter table public.group_messages
  add column if not exists private_to uuid references public.profiles(id) on delete cascade;

drop policy if exists "group chat: members read" on public.group_messages;
create policy "group chat: members read" on public.group_messages
  for select to authenticated
  using (is_group_member(group_id) and (private_to is null or private_to = auth.uid()));

create table if not exists public.group_welcome_notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.study_groups(id) on delete cascade,
  message_id uuid not null references public.group_messages(id) on delete cascade,
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists idx_group_welcome_unread
  on public.group_welcome_notifications(profile_id, created_at desc) where read_at is null;
alter table public.group_welcome_notifications enable row level security;
drop policy if exists "students read own group welcome notifications" on public.group_welcome_notifications;
create policy "students read own group welcome notifications" on public.group_welcome_notifications
  for select to authenticated using (profile_id = auth.uid());
revoke all on public.group_welcome_notifications from anon, authenticated;
grant select on public.group_welcome_notifications to authenticated;

-- One automatically-created study group belongs to each course.
-- Keep any existing course-linked group instead of creating a duplicate.
create or replace function public.ensure_course_study_group()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_group_id uuid;
  v_owner_name text;
begin
  select id into v_group_id from public.study_groups
  where course_id = new.id order by created_at, id limit 1;

  if v_group_id is null then
    insert into public.study_groups(department_id, course_id, name, description, owner_id)
    values (new.department_id, new.id, new.code || ' · ' || new.title,
      'Official study group for ' || new.code || ' — ' || new.title, new.created_by)
    returning id into v_group_id;
  end if;

  insert into public.group_members(group_id, profile_id)
  values (v_group_id, new.created_by) on conflict do nothing;

  insert into public.group_members(group_id, profile_id)
  select v_group_id, cm.profile_id
  from public.course_members cm
  join public.profiles p on p.id = cm.profile_id and p.role = 'student'
  where cm.course_id = new.id
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists trg_ensure_course_study_group on public.courses;
create trigger trg_ensure_course_study_group
after insert on public.courses
for each row execute function public.ensure_course_study_group();

-- Students added to a course are automatically added to its group.
create or replace function public.add_course_member_to_study_group()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.profiles where id = new.profile_id and role = 'student') then
    insert into public.group_members(group_id, profile_id)
    select g.id, new.profile_id
    from public.study_groups g
    where g.course_id = new.course_id
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_add_course_member_to_study_group on public.course_members;
create trigger trg_add_course_member_to_study_group
after insert on public.course_members
for each row execute function public.add_course_member_to_study_group();

-- Backfill groups for courses that existed before this migration.
insert into public.study_groups(department_id, course_id, name, description, owner_id)
select c.department_id, c.id, c.code || ' · ' || c.title,
  'Official study group for ' || c.code || ' — ' || c.title, c.created_by
from public.courses c
where not exists (select 1 from public.study_groups g where g.course_id = c.id);

-- Make sure the course creator and all current students are in the linked group.
insert into public.group_members(group_id, profile_id)
select g.id, c.created_by
from public.courses c join public.study_groups g on g.course_id = c.id
on conflict do nothing;

insert into public.group_members(group_id, profile_id)
select g.id, cm.profile_id
from public.study_groups g
join public.course_members cm on cm.course_id = g.course_id
join public.profiles p on p.id = cm.profile_id and p.role = 'student'
where g.course_id is not null
on conflict do nothing;

create or replace function public.create_course_group_welcome()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_group public.study_groups;
  v_role text;
  v_course public.courses;
  v_title text;
  v_body text;
  v_message_id uuid;
begin
  select * into v_group from public.study_groups where id = new.group_id;
  if not found or (not v_group.official and v_group.course_id is null) then return new; end if;
  select role into v_role from public.profiles where id = new.profile_id;
  if v_role is distinct from 'student' then return new; end if;

  if v_group.course_id is not null then
    select * into v_course from public.courses where id = v_group.course_id;
    v_title := 'Welcome to ' || v_course.code || ' — ' || v_course.title;
    v_body := 'Welcome! This is your course study group for class messages, questions, shared learning resources and important updates.';
  else
    v_title := 'Welcome to your ' || v_group.name || ' Study Group';
    v_body := 'Welcome! This is your class group for messages, questions, shared learning resources and important updates.';
  end if;

  insert into public.group_messages(group_id, author_id, body, private_to)
  values (v_group.id, v_group.owner_id, v_body, new.profile_id)
  returning id into v_message_id;

  insert into public.group_welcome_notifications(profile_id, group_id, message_id, title, body)
  values (new.profile_id, v_group.id, v_message_id, v_title, v_body);
  return new;
end;
$$;

drop trigger if exists trg_official_group_welcome on public.group_members;
drop trigger if exists trg_course_group_welcome on public.group_members;
create trigger trg_course_group_welcome
after insert on public.group_members
for each row execute function public.create_course_group_welcome();

-- Existing students already in official or course-linked groups receive a one-time welcome.
with candidates as (
  select m.profile_id, g.id as group_id, g.owner_id,
    case when g.course_id is not null then 'Welcome to ' || c.code || ' — ' || c.title
      else 'Welcome to your ' || g.name || ' Study Group' end as title,
    case when g.course_id is not null
      then 'Welcome! This is your course study group for class messages, questions, shared learning resources and important updates.'
      else 'Welcome! This is your class group for messages, questions, shared learning resources and important updates.' end as body
  from public.group_members m
  join public.study_groups g on g.id = m.group_id
  join public.profiles p on p.id = m.profile_id and p.role = 'student'
  left join public.courses c on c.id = g.course_id
  where (g.official or g.course_id is not null)
    and not exists (select 1 from public.group_welcome_notifications n
      where n.profile_id = m.profile_id and n.group_id = g.id)
), inserted_messages as (
  insert into public.group_messages(group_id, author_id, body, private_to)
  select c.group_id, c.owner_id, c.body, c.profile_id from candidates c
  returning id, group_id, private_to
)
insert into public.group_welcome_notifications(profile_id, group_id, message_id, title, body)
select im.private_to, im.group_id, im.id, c.title, c.body
from inserted_messages im
join candidates c on c.profile_id = im.private_to and c.group_id = im.group_id;

create or replace function public.list_group_messages(p_group_id uuid, p_before timestamptz default null, p_limit int default 40)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_group_member(p_group_id) then raise exception 'Not a member of this group'; end if;
  return coalesce((
    select jsonb_agg(x order by x.created_at desc) from (
      select m.id, m.author_id, pr.name as author_name, pr.avatar_path, m.body, m.created_at
      from public.group_messages m join public.profiles pr on pr.id = m.author_id
      where m.group_id = p_group_id and (m.private_to is null or m.private_to = auth.uid())
        and (p_before is null or m.created_at < p_before)
      order by m.created_at desc limit least(greatest(coalesce(p_limit, 40), 1), 100)
    ) x), '[]'::jsonb);
end;
$$;

create or replace function public.my_group_welcome_notifications()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  return coalesce((
    select jsonb_agg(x order by x.created_at desc) from (
      select n.id, n.group_id, g.name as group_name, n.title, n.body, n.created_at
      from public.group_welcome_notifications n
      join public.study_groups g on g.id = n.group_id
      where n.profile_id = auth.uid() and n.read_at is null
      order by n.created_at desc limit 20
    ) x), '[]'::jsonb);
end;
$$;

create or replace function public.mark_group_welcome_notification_read(p_notification_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  update public.group_welcome_notifications set read_at = now()
  where id = p_notification_id and profile_id = auth.uid() and read_at is null;
end;
$$;

revoke all on function public.ensure_course_study_group() from public;
revoke all on function public.add_course_member_to_study_group() from public;
revoke all on function public.create_course_group_welcome() from public;
revoke all on function public.list_group_messages(uuid,timestamptz,int) from public;
revoke all on function public.my_group_welcome_notifications() from public;
revoke all on function public.mark_group_welcome_notification_read(uuid) from public;
grant execute on function public.list_group_messages(uuid,timestamptz,int) to authenticated;
grant execute on function public.my_group_welcome_notifications() to authenticated;
grant execute on function public.mark_group_welcome_notification_read(uuid) to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.group_welcome_notifications; exception when duplicate_object then null; end;
  end if;
end $$;
