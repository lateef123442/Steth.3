-- 054: private welcome notes and in-app alerts when students join official class groups.
-- The note is a real group-chat message, but only its recipient can read it.

alter table public.group_messages add column if not exists private_to uuid references public.profiles(id) on delete cascade;

drop policy if exists "group chat: members read" on public.group_messages;
create policy "group chat: members read" on public.group_messages for select to authenticated
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
create index if not exists idx_group_welcome_unread on public.group_welcome_notifications(profile_id, created_at desc) where read_at is null;
alter table public.group_welcome_notifications enable row level security;
drop policy if exists "students read own group welcome notifications" on public.group_welcome_notifications;
create policy "students read own group welcome notifications" on public.group_welcome_notifications
  for select to authenticated using (profile_id = auth.uid());
revoke all on public.group_welcome_notifications from anon, authenticated;
grant select on public.group_welcome_notifications to authenticated;

create or replace function public.create_official_group_welcome()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_group public.study_groups;
  v_role text;
  v_department text;
  v_title text;
  v_body text;
  v_message_id uuid;
begin
  select * into v_group from public.study_groups where id = new.group_id;
  if not found or not v_group.official then return new; end if;
  select role into v_role from public.profiles where id = new.profile_id;
  if v_role is distinct from 'student' then return new; end if;
  select name into v_department from public.departments where id = v_group.department_id;
  v_title := 'Welcome to the ' || coalesce(v_department, v_group.name) || ' Study Group';
  v_body := 'Welcome! This is your class group for messages, questions, shared learning resources and important updates.';

  insert into public.group_messages(group_id, author_id, body, private_to)
  values (v_group.id, v_group.owner_id, v_body, new.profile_id)
  returning id into v_message_id;

  insert into public.group_welcome_notifications(profile_id, group_id, message_id, title, body)
  values (new.profile_id, v_group.id, v_message_id, v_title, v_body);
  return new;
end;
$$;

drop trigger if exists trg_official_group_welcome on public.group_members;
create trigger trg_official_group_welcome after insert on public.group_members
  for each row execute function public.create_official_group_welcome();

-- Existing students already in official groups receive the same private welcome once.
with candidates as (
  select m.profile_id, g.id as group_id, g.owner_id,
    'Welcome to the ' || coalesce(d.name, g.name) || ' Study Group' as title,
    'Welcome! This is your class group for messages, questions, shared learning resources and important updates.' as body
  from public.group_members m
  join public.study_groups g on g.id = m.group_id and g.official
  join public.profiles p on p.id = m.profile_id and p.role = 'student'
  left join public.departments d on d.id = g.department_id
  where not exists (
    select 1 from public.group_welcome_notifications n
    where n.profile_id = m.profile_id and n.group_id = g.id
  )
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

revoke all on function public.create_official_group_welcome() from public;
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
