-- 064: persistent in-app notification center, event notifications and teacher broadcasts.
-- Run after 063_course_daily_one_attempt.sql.

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  kind text not null check (kind in ('announcement','direct_message','group_message','friend_request','friend_request_accepted','admin_request','admin_reply')),
  title text not null check (char_length(title) between 1 and 180),
  body text not null default '' check (char_length(body) <= 500),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  push_sent_at timestamptz
);
create index if not exists user_notifications_inbox_idx on public.user_notifications(recipient_id, created_at desc);
create index if not exists user_notifications_unread_idx on public.user_notifications(recipient_id, created_at desc) where read_at is null;
alter table public.user_notifications enable row level security;
drop policy if exists user_notifications_select_own on public.user_notifications;
create policy user_notifications_select_own on public.user_notifications for select to authenticated using (recipient_id = auth.uid());
drop policy if exists user_notifications_update_own on public.user_notifications;
create policy user_notifications_update_own on public.user_notifications for update to authenticated using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
revoke all on public.user_notifications from anon, authenticated;
grant select on public.user_notifications to authenticated;
grant update(read_at) on public.user_notifications to authenticated;

create table if not exists public.teacher_announcements (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 3 and 100),
  body text not null check (char_length(trim(body)) between 5 and 2000),
  audience text not null check (audience in ('assigned_departments','all_students')),
  created_at timestamptz not null default now()
);
alter table public.teacher_announcements enable row level security;
revoke all on public.teacher_announcements from anon, authenticated;

create or replace function public.my_notifications(p_limit integer default 60)
returns table(id uuid, kind text, title text, body text, data jsonb, created_at timestamptz, read_at timestamptz, actor_name text)
language sql stable security definer set search_path = public as $$
  select n.id, n.kind, n.title, n.body, n.data, n.created_at, n.read_at, p.name as actor_name
  from public.user_notifications n
  left join public.profiles p on p.id = n.actor_id
  where n.recipient_id = auth.uid()
  order by n.created_at desc
  limit least(greatest(coalesce(p_limit, 60), 1), 100);
$$;

create or replace function public.my_unread_notification_count()
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::integer from public.user_notifications where recipient_id = auth.uid() and read_at is null;
$$;

create or replace function public.mark_notification_read(p_notification_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  update public.user_notifications set read_at = coalesce(read_at, now()) where id = p_notification_id and recipient_id = auth.uid();
end;
$$;

create or replace function public.mark_all_notifications_read()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  update public.user_notifications set read_at = now() where recipient_id = auth.uid() and read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.mark_group_notifications_read(p_group_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_group_member(p_group_id) then raise exception 'Not a group member'; end if;
  update public.user_notifications set read_at = coalesce(read_at, now())
  where recipient_id = auth.uid() and kind = 'group_message' and data->>'group_id' = p_group_id::text and read_at is null;
end;
$$;

create or replace function public.mark_direct_message_notifications_read(p_sender_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  update public.user_notifications set read_at = coalesce(read_at, now())
  where recipient_id = auth.uid() and kind = 'direct_message' and data->>'sender_id' = p_sender_id::text and read_at is null;
end;
$$;

-- Teachers can broadcast to students in departments they are assigned to; admins can broadcast to all students.
create or replace function public.send_teacher_announcement(p_title text, p_body text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_role text; v_name text; v_id uuid; v_count integer;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select role, name into v_role, v_name from public.profiles where id = v_uid;
  if v_role is distinct from 'teacher' and v_role is distinct from 'admin' then raise exception 'Only teachers and admins can send announcements'; end if;
  if char_length(trim(coalesce(p_title,''))) not between 3 and 100 then raise exception 'Title must be 3–100 characters'; end if;
  if char_length(trim(coalesce(p_body,''))) not between 5 and 2000 then raise exception 'Message must be 5–2000 characters'; end if;
  if v_role = 'teacher' and not exists (
    select 1 from public.profiles p where p.role = 'student' and public.teaches_department(v_uid, p.department_id)
  ) then raise exception 'You have no assigned student departments'; end if;

  insert into public.teacher_announcements(author_id,title,body,audience)
  values (v_uid, trim(p_title), trim(p_body), case when v_role = 'admin' then 'all_students' else 'assigned_departments' end)
  returning id into v_id;

  insert into public.user_notifications(recipient_id,actor_id,kind,title,body,data)
  select p.id, v_uid, 'announcement', left('📣 ' || coalesce(v_name,'Steth teacher') || ': ' || trim(p_title),180), left(trim(p_body),500),
         jsonb_build_object('announcement_id',v_id)
  from public.profiles p
  where p.role = 'student'
    and (v_role = 'admin' or public.teaches_department(v_uid, p.department_id));
  get diagnostics v_count = row_count;
  return jsonb_build_object('announcement_id',v_id,'recipient_count',v_count);
end;
$$;

-- Message and request events create inbox records server-side, so clients cannot forge notifications.
create or replace function public.notify_new_direct_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  select name into v_name from public.profiles where id = new.sender_id;
  insert into public.user_notifications(recipient_id,actor_id,kind,title,body,data)
  values (new.recipient_id,new.sender_id,'direct_message','New message from ' || coalesce(v_name,'Someone'),left(new.body,500),
          jsonb_build_object('sender_id',new.sender_id,'message_id',new.id));
  return new;
end;
$$;
drop trigger if exists trg_notify_new_direct_message on public.direct_messages;
create trigger trg_notify_new_direct_message after insert on public.direct_messages for each row execute function public.notify_new_direct_message();

create or replace function public.notify_new_group_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text; v_group text;
begin
  select name into v_name from public.profiles where id = new.author_id;
  select name into v_group from public.study_groups where id = new.group_id;
  insert into public.user_notifications(recipient_id,actor_id,kind,title,body,data)
  select gm.profile_id,new.author_id,'group_message','New message in ' || coalesce(v_group,'your study group'),
         coalesce(v_name,'Someone') || ': ' || left(new.body,400),
         jsonb_build_object('group_id',new.group_id,'group_name',coalesce(v_group,'Study group'),'sender_id',new.author_id,'message_id',new.id)
  from public.group_members gm
  where gm.group_id = new.group_id and gm.profile_id <> new.author_id
    and (new.private_to is null or gm.profile_id = new.private_to);
  return new;
end;
$$;
drop trigger if exists trg_notify_new_group_message on public.group_messages;
create trigger trg_notify_new_group_message after insert on public.group_messages for each row execute function public.notify_new_group_message();

create or replace function public.notify_friendship_events()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    select name into v_name from public.profiles where id = new.requester;
    insert into public.user_notifications(recipient_id,actor_id,kind,title,body,data)
    values (new.addressee,new.requester,'friend_request','New friend request',coalesce(v_name,'A student') || ' wants to connect with you',jsonb_build_object('user_id',new.requester));
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    select name into v_name from public.profiles where id = new.addressee;
    insert into public.user_notifications(recipient_id,actor_id,kind,title,body,data)
    values (new.requester,new.addressee,'friend_request_accepted','Friend request accepted',coalesce(v_name,'Your friend') || ' accepted your request',jsonb_build_object('user_id',new.addressee));
  end if;
  return new;
end;
$$;
drop trigger if exists trg_notify_friendship_events on public.friendships;
create trigger trg_notify_friendship_events after insert or update of status on public.friendships for each row execute function public.notify_friendship_events();

create or replace function public.notify_feedback_events()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.user_notifications(recipient_id,actor_id,kind,title,body,data)
    select p.id,new.author_id,'admin_request','New student request',left(new.subject,500),jsonb_build_object('feedback_id',new.id)
    from public.profiles p where p.role = 'admin' and new.author_id <> p.id;
  elsif new.admin_reply is distinct from old.admin_reply and char_length(trim(coalesce(new.admin_reply,''))) > 0 then
    insert into public.user_notifications(recipient_id,actor_id,kind,title,body,data)
    values (new.author_id,null,'admin_reply','The Steth team replied to your request',left(new.admin_reply,500),jsonb_build_object('feedback_id',new.id));
  end if;
  return new;
end;
$$;
drop trigger if exists trg_notify_feedback_events on public.feedback;
create trigger trg_notify_feedback_events after insert or update of admin_reply on public.feedback for each row execute function public.notify_feedback_events();

-- Keep notification read-state in sync when a student opens the relevant conversation.
revoke all on function public.my_notifications(integer) from public, anon;
revoke all on function public.my_unread_notification_count() from public, anon;
revoke all on function public.mark_notification_read(uuid) from public, anon;
revoke all on function public.mark_all_notifications_read() from public, anon;
revoke all on function public.mark_group_notifications_read(uuid) from public, anon;
revoke all on function public.mark_direct_message_notifications_read(uuid) from public, anon;
revoke all on function public.send_teacher_announcement(text,text) from public, anon;
grant execute on function public.my_notifications(integer) to authenticated;
grant execute on function public.my_unread_notification_count() to authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;
grant execute on function public.mark_group_notifications_read(uuid) to authenticated;
grant execute on function public.mark_direct_message_notifications_read(uuid) to authenticated;
grant execute on function public.send_teacher_announcement(text,text) to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.user_notifications; exception when duplicate_object then null; end;
  end if;
end $$;
notify pgrst, 'reload schema';
