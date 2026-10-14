-- Single-use teacher invite codes, class study groups, friends, private + group realtime chat, profile pictures.
-- Run after 025_levels_topics_assessments.sql.  NOT yet executed: review and test on staging first.
--
--  1. Invite codes are DELETED the moment a teacher redeems one.
--  2. A teacher creates a study group for a year of their own department. Every student of that department + year
--     is added immediately, and every student who signs up later is added the moment their profile is created.
--  3. Friends: search students by name (results show department and year), send / accept / decline requests.
--  4. Private messages between friends and a chat inside every study group. Both are broadcast live through
--     Supabase Realtime (the tables are added to the supabase_realtime publication; row-level security decides who
--     receives each row). Writes go through functions that check membership / friendship and rate-limit senders.
--  5. Profile pictures: a public 'avatars' bucket, one folder per user, registered through set_my_avatar().
--
-- Realtime must be enabled for the project (Database -> Replication). Messages are NOT end-to-end encrypted: anyone
-- with database access can read them. Say so in your privacy policy.

-- ─────────────────────────────────────────────
-- A. Invite codes: delete on use
-- ─────────────────────────────────────────────
create or replace function complete_teacher_signup(p_name text, p_university text, p_department_id uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_caller_id uuid := auth.uid(); v_code_row record;
begin
  if v_caller_id is null then raise exception 'Not authenticated'; end if;
  select * into v_code_row from teacher_invite_codes
   where code = upper(trim(p_code)) and department_id = p_department_id for update;
  if not found then raise exception 'Invalid or already used invite code for this department'; end if;

  insert into profiles (id, name, university, department_id, year, role)
  values (v_caller_id, trim(p_name), trim(p_university), p_department_id, null, 'teacher')
  on conflict (id) do update set name = excluded.name, university = excluded.university,
    department_id = excluded.department_id, role = 'teacher';

  delete from teacher_invite_codes where id = v_code_row.id; -- single use: gone once redeemed
  return jsonb_build_object('success', true);
end;
$$;
-- Codes that were already marked used by the old behaviour are removed too.
delete from teacher_invite_codes where used_by is not null;

-- ─────────────────────────────────────────────
-- B. Profile pictures
-- ─────────────────────────────────────────────
alter table profiles add column if not exists avatar_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars: upload own" on storage.objects;
drop policy if exists "avatars: delete own" on storage.objects;
create policy "avatars: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- p_path null removes the picture.
create or replace function set_my_avatar(p_path text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_path is not null then
    if left(p_path, char_length(auth.uid()::text) + 1) <> auth.uid()::text || '/' then raise exception 'Invalid picture path'; end if;
    if not exists (select 1 from storage.objects where bucket_id = 'avatars' and name = p_path) then raise exception 'The upload did not finish. Try again'; end if;
  end if;
  update profiles set avatar_path = p_path where id = auth.uid();
  return p_path;
end;
$$;

-- ─────────────────────────────────────────────
-- C. Class study groups (teacher-created, per department + year)
-- ─────────────────────────────────────────────
alter table study_groups add column if not exists year int check (year between 1 and 7);
alter table study_groups add column if not exists official boolean not null default false;

create or replace function create_year_group(p_name text, p_description text, p_year int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_role text; v_dept uuid; v_years int[]; v_row study_groups; v_added int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select role, department_id, teaching_years into v_role, v_dept, v_years from profiles where id = v_uid;
  if v_role is distinct from 'teacher' or v_dept is null then raise exception 'Only teachers can create class groups'; end if;
  if p_year is null or p_year not between 1 and 7 then raise exception 'Choose a year'; end if;
  if coalesce(array_length(v_years, 1), 0) > 0 and not (p_year = any (v_years)) then raise exception 'You are not assigned to Year %', p_year; end if;
  if char_length(trim(p_name)) < 2 then raise exception 'Give the group a name'; end if;
  if (select count(*) from study_groups where owner_id = v_uid and official) >= 20 then raise exception 'You can run up to 20 class groups'; end if;

  insert into study_groups (department_id, year, official, name, description, owner_id)
  values (v_dept, p_year, true, trim(p_name), coalesce(trim(p_description), ''), v_uid) returning * into v_row;
  insert into group_members (group_id, profile_id) values (v_row.id, v_uid);
  insert into group_members (group_id, profile_id)
  select v_row.id, p.id from profiles p where p.role = 'student' and p.department_id = v_dept and p.year = p_year on conflict do nothing;
  get diagnostics v_added = row_count;
  return jsonb_build_object('id', v_row.id, 'join_code', v_row.join_code, 'students_added', v_added);
end;
$$;

-- New students (or students who change department / year) join the matching class groups straight away.
create or replace function join_official_groups() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'student' and new.department_id is not null and new.year is not null then
    insert into group_members (group_id, profile_id)
    select g.id, new.id from study_groups g where g.official and g.department_id = new.department_id and g.year = new.year
    on conflict do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_join_official_groups on profiles;
create trigger trg_join_official_groups after insert or update of department_id, year, role on profiles
  for each row execute function join_official_groups();

create or replace function leave_study_group(p_group_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if exists (select 1 from study_groups where id = p_group_id and owner_id = auth.uid()) then raise exception 'Owners delete the group instead of leaving it'; end if;
  if exists (select 1 from study_groups where id = p_group_id and official) then raise exception 'This is your class group, so you can''t leave it'; end if;
  delete from group_members where group_id = p_group_id and profile_id = auth.uid();
end;
$$;

create or replace function my_study_groups() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  return coalesce((
    select jsonb_agg(x order by x.official desc, x.name) from (
      select g.id, g.name, g.description, g.owner_id, g.course_id, g.year, g.official,
        (select pr.name from profiles pr where pr.id = g.owner_id) as owner_name,
        case when g.owner_id = auth.uid() then g.join_code else null end as join_code,
        (select count(*) from group_members m2 where m2.group_id = g.id) as member_count,
        (select c.title from group_challenges c where c.group_id = g.id and c.ends_on >= current_date order by c.ends_on limit 1) as active_challenge
      from study_groups g join group_members m on m.group_id = g.id and m.profile_id = auth.uid()
    ) x), '[]'::jsonb);
end;
$$;

-- ─────────────────────────────────────────────
-- D. Friends
-- ─────────────────────────────────────────────
create table if not exists friendships (
  requester uuid not null references profiles (id) on delete cascade,
  addressee uuid not null references profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (requester, addressee),
  check (requester <> addressee)
);
create unique index if not exists uq_friend_pair on friendships (least(requester, addressee), greatest(requester, addressee));
create index if not exists idx_friendships_addressee on friendships (addressee, status);
alter table friendships enable row level security; -- no policies: functions only

create or replace function are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from friendships where status = 'accepted' and ((requester = a and addressee = b) or (requester = b and addressee = a)));
$$;

-- Names only, never emails. Shows department and year so you know who you are adding.
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
      where p.role = 'student' and p.id <> auth.uid()
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
  if (select role from profiles where id = v_me) is distinct from 'student' or (select role from profiles where id = p_user) is distinct from 'student' then
    raise exception 'Friends are student to student';
  end if;
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

create or replace function respond_friend_request(p_user uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_accept then
    update friendships set status = 'accepted', responded_at = now() where requester = p_user and addressee = auth.uid() and status = 'pending';
    if not found then raise exception 'Request not found'; end if;
  else
    delete from friendships where requester = p_user and addressee = auth.uid() and status = 'pending';
  end if;
end;
$$;

create or replace function remove_friend(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  delete from friendships where (requester = auth.uid() and addressee = p_user) or (requester = p_user and addressee = auth.uid());
end;
$$;

create or replace function my_friends() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  return jsonb_build_object(
    'friends', coalesce((select jsonb_agg(x order by x.name) from (
      select p.id, p.name, d.name as department, p.year, p.avatar_path from friendships f
      join profiles p on p.id = case when f.requester = v_me then f.addressee else f.requester end
      left join departments d on d.id = p.department_id
      where f.status = 'accepted' and v_me in (f.requester, f.addressee)) x), '[]'::jsonb),
    'incoming', coalesce((select jsonb_agg(x order by x.name) from (
      select p.id, p.name, d.name as department, p.year, p.avatar_path from friendships f
      join profiles p on p.id = f.requester left join departments d on d.id = p.department_id
      where f.status = 'pending' and f.addressee = v_me) x), '[]'::jsonb),
    'outgoing', coalesce((select jsonb_agg(x order by x.name) from (
      select p.id, p.name, d.name as department, p.year, p.avatar_path from friendships f
      join profiles p on p.id = f.addressee left join departments d on d.id = p.department_id
      where f.status = 'pending' and f.requester = v_me) x), '[]'::jsonb));
end;
$$;

-- ─────────────────────────────────────────────
-- E. Private messages (friends only) + group chat, both realtime
-- ─────────────────────────────────────────────
create table if not exists direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references profiles (id) on delete cascade,
  recipient_id uuid not null references profiles (id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (sender_id <> recipient_id)
);
create index if not exists idx_dm_pair on direct_messages (sender_id, recipient_id, created_at desc);
create index if not exists idx_dm_inbox on direct_messages (recipient_id, sender_id, created_at desc);
alter table direct_messages enable row level security;
drop policy if exists "dm: participants read" on direct_messages;
create policy "dm: participants read" on direct_messages for select to authenticated using (sender_id = auth.uid() or recipient_id = auth.uid());

create table if not exists group_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references study_groups (id) on delete cascade,
  author_id uuid not null references profiles (id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists idx_group_messages on group_messages (group_id, created_at desc);
alter table group_messages enable row level security;
drop policy if exists "group chat: members read" on group_messages;
create policy "group chat: members read" on group_messages for select to authenticated using (is_group_member(group_id));

-- Turn on live delivery. (Skipped quietly if the project has no realtime publication.)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table direct_messages; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table group_messages; exception when duplicate_object then null; end;
  end if;
end;
$$;

create or replace function send_direct_message(p_to uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_row direct_messages;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  if not are_friends(v_me, p_to) then raise exception 'You can only message friends'; end if;
  if (select count(*) from direct_messages where sender_id = v_me and created_at > now() - interval '1 minute') >= 30 then raise exception 'Slow down a little'; end if;
  insert into direct_messages (sender_id, recipient_id, body) values (v_me, p_to, trim(p_body)) returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'sender_id', v_row.sender_id, 'body', v_row.body, 'created_at', v_row.created_at);
end;
$$;

create or replace function list_conversation(p_with uuid, p_before timestamptz default null, p_limit int default 40) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  return coalesce((
    select jsonb_agg(x order by x.created_at desc) from (
      select m.id, m.sender_id, m.body, m.created_at from direct_messages m
      where ((m.sender_id = auth.uid() and m.recipient_id = p_with) or (m.sender_id = p_with and m.recipient_id = auth.uid()))
        and (p_before is null or m.created_at < p_before)
      order by m.created_at desc limit least(greatest(coalesce(p_limit, 40), 1), 100)
    ) x), '[]'::jsonb);
end;
$$;

create or replace function mark_conversation_read(p_with uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  update direct_messages set read_at = now() where recipient_id = auth.uid() and sender_id = p_with and read_at is null;
end;
$$;

-- One row per person you have chatted with: last message and unread count.
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
    ) x), '[]'::jsonb);
end;
$$;

create or replace function send_group_message(p_group_id uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_row group_messages;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  if not is_group_member(p_group_id) then raise exception 'Not a member of this group'; end if;
  if (select count(*) from group_messages where author_id = v_me and created_at > now() - interval '1 minute') >= 30 then raise exception 'Slow down a little'; end if;
  insert into group_messages (group_id, author_id, body) values (p_group_id, v_me, trim(p_body)) returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'group_id', v_row.group_id, 'author_id', v_row.author_id, 'body', v_row.body, 'created_at', v_row.created_at);
end;
$$;

create or replace function list_group_messages(p_group_id uuid, p_before timestamptz default null, p_limit int default 40) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_group_member(p_group_id) then raise exception 'Not a member of this group'; end if;
  return coalesce((
    select jsonb_agg(x order by x.created_at desc) from (
      select m.id, m.author_id, pr.name as author_name, pr.avatar_path, m.body, m.created_at
      from group_messages m join profiles pr on pr.id = m.author_id
      where m.group_id = p_group_id and (p_before is null or m.created_at < p_before)
      order by m.created_at desc limit least(greatest(coalesce(p_limit, 40), 1), 100)
    ) x), '[]'::jsonb);
end;
$$;

create or replace function group_members_list(p_group_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_group_member(p_group_id) then raise exception 'Not a member of this group'; end if;
  return coalesce((
    select jsonb_agg(x order by x.is_owner desc, x.name) from (
      select pr.id, pr.name, d.name as department, pr.year, pr.avatar_path, pr.role, (g.owner_id = pr.id) as is_owner
      from group_members m join study_groups g on g.id = m.group_id
      join profiles pr on pr.id = m.profile_id left join departments d on d.id = pr.department_id
      where m.group_id = p_group_id limit 500
    ) x), '[]'::jsonb);
end;
$$;

-- Any member can bring in a fellow student: a friend, or a classmate from their own department and year
-- (teachers can add any student of their department).
create or replace function add_group_member(p_group_id uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_me profiles; v_t profiles;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not is_group_member(p_group_id) then raise exception 'Not a member of this group'; end if;
  select * into v_me from profiles where id = auth.uid();
  select * into v_t from profiles where id = p_user;
  if not found or v_t.role <> 'student' then raise exception 'You can only add students'; end if;
  if not (are_friends(v_me.id, v_t.id)
          or (v_t.department_id is not distinct from v_me.department_id and (v_me.role = 'teacher' or v_t.year is not distinct from v_me.year))) then
    raise exception 'Add them as a friend first, or pick someone from your own department and year';
  end if;
  if (select count(*) from group_members where group_id = p_group_id) >= 500 then raise exception 'This group is full'; end if;
  insert into group_members (group_id, profile_id) values (p_group_id, p_user) on conflict do nothing;
end;
$$;

-- ─────────────────────────────────────────────
-- F. Grants
-- ─────────────────────────────────────────────
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (array[
      'complete_teacher_signup', 'set_my_avatar', 'create_year_group', 'leave_study_group', 'my_study_groups', 'search_people',
      'send_friend_request', 'respond_friend_request', 'remove_friend', 'my_friends', 'send_direct_message', 'list_conversation',
      'mark_conversation_read', 'my_conversations', 'send_group_message', 'list_group_messages', 'group_members_list', 'add_group_member'])
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (array['are_friends', 'join_official_groups'])
  loop
    execute format('revoke all on function %s from public', r.sig);
  end loop;
end;
$$;
