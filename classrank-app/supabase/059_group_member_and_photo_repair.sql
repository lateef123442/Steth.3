-- 059: repair group member listing and ensure group profile-photo schema is installed.
-- Safe to run after earlier group migrations; all objects are created idempotently.

alter table public.group_members
  add column if not exists group_role text not null default 'member';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.group_members'::regclass
      and conname = 'group_members_group_role_check'
  ) then
    alter table public.group_members
      add constraint group_members_group_role_check
      check (group_role in ('member', 'admin'));
  end if;
end;
$$;

create or replace function public.group_members_list(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'Not a member of this group';
  end if;
  return coalesce((
    select jsonb_agg(x order by x.is_owner desc, x.name)
    from (
      select pr.id, pr.name, d.name as department, pr.year, pr.avatar_path, pr.role,
        (g.owner_id = pr.id) as is_owner,
        case when g.owner_id = pr.id then 'owner' else m.group_role end as group_role
      from public.group_members m
      join public.study_groups g on g.id = m.group_id
      join public.profiles pr on pr.id = m.profile_id
      left join public.departments d on d.id = pr.department_id
      where m.group_id = p_group_id
      limit 500
    ) x
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.group_members_list(uuid) from public, anon;
grant execute on function public.group_members_list(uuid) to authenticated;

-- 058: group profile pictures for study groups.

alter table public.study_groups
  add column if not exists group_avatar_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('group-avatars', 'group-avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "group avatars: upload for managed groups" on storage.objects;
drop policy if exists "group avatars: delete for managed groups" on storage.objects;
create policy "group avatars: upload for managed groups"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'group-avatars'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and public.is_group_manager(((storage.foldername(name))[1])::uuid)
  and (storage.foldername(name))[2] = auth.uid()::text
);
create policy "group avatars: delete for managed groups"
on storage.objects for delete to authenticated
using (
  bucket_id = 'group-avatars'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and public.is_group_manager(((storage.foldername(name))[1])::uuid)
);

create or replace function public.set_group_avatar(p_group_id uuid, p_path text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_group_manager(p_group_id) then
    raise exception 'Only the group owner or an appointed admin can change the group photo';
  end if;
  if p_path is not null then
    if left(p_path, char_length(p_group_id::text) + 1) <> p_group_id::text || '/' then
      raise exception 'Invalid group photo path';
    end if;
    if split_part(p_path, '/', 2) <> auth.uid()::text then
      raise exception 'Invalid group photo owner';
    end if;
    if not exists (select 1 from storage.objects where bucket_id = 'group-avatars' and name = p_path) then
      raise exception 'The upload did not finish. Try again';
    end if;
  end if;
  update public.study_groups set group_avatar_path = p_path where id = p_group_id;
  return p_path;
end;
$$;

revoke all on function public.set_group_avatar(uuid, text) from public, anon;
grant execute on function public.set_group_avatar(uuid, text) to authenticated;

-- Include the group profile image in the existing group-list RPC payload.
create or replace function public.my_study_groups()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  return coalesce((
    select jsonb_agg(x order by x.name) from (
      select g.id, g.name, g.description, g.owner_id, g.course_id, g.group_avatar_path,
        case when g.owner_id = auth.uid() then g.join_code else null end as join_code,
        (select count(*) from public.group_members m2 where m2.group_id = g.id) as member_count,
        (select c.title from public.group_challenges c where c.group_id = g.id and c.ends_on >= current_date
          order by c.ends_on limit 1) as active_challenge
      from public.study_groups g
      join public.group_members m on m.group_id = g.id and m.profile_id = auth.uid()
    ) x
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.my_study_groups() from public, anon;
grant execute on function public.my_study_groups() to authenticated;
