-- 049: Public social profiles and live feed activity.
-- Apply after 048_feed_comments.sql.

alter table public.profiles
  add column if not exists bio text not null default '';

alter table public.profiles
  drop constraint if exists profiles_bio_length_check;
alter table public.profiles
  add constraint profiles_bio_length_check
  check (char_length(btrim(bio)) <= 240);

-- Keep the original two-argument update_my_account_profile overload intact
-- for older app builds; the current app uses this three-argument version.
create or replace function public.update_my_account_profile(
  p_name text,
  p_username text,
  p_bio text
)
returns table (name text, username text, bio text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_username text := lower(btrim(regexp_replace(coalesce(p_username, ''), '^@', '')));
  v_bio text := btrim(coalesce(p_bio, ''));
begin
  if v_user_id is null then raise exception 'You must be signed in to update your profile.'; end if;
  if length(v_name) < 2 or length(v_name) > 60 then raise exception 'Name must be between 2 and 60 characters.'; end if;
  if v_username !~ '^[a-z0-9_]{3,20}$' then raise exception 'Username must be 3–20 characters using lowercase letters, numbers or underscores.'; end if;
  if char_length(v_bio) > 240 then raise exception 'Bio must be 240 characters or fewer.'; end if;

  begin
    update public.profiles p
      set name = v_name, username = v_username, bio = v_bio
      where p.id = v_user_id;
    if not found then raise exception 'Your profile could not be found.'; end if;
  exception when unique_violation then
    raise exception 'That username is already taken.' using errcode = '23505';
  end;

  return query select p.name, p.username, p.bio from public.profiles p where p.id = v_user_id;
end;
$$;

revoke all on function public.update_my_account_profile(text, text, text) from public, anon;
grant execute on function public.update_my_account_profile(text, text, text) to authenticated;

-- Return only fields suitable for a public profile. Never expose email or auth metadata.
-- Respect blocks in either direction and only count posts visible to the viewer.
create or replace function public.get_public_profile(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_me_department uuid;
  v_person record;
  v_relation text := 'none';
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  if p_user_id is null then return null; end if;
  if exists (
    select 1 from public.user_blocks b
    where (b.blocker = v_me and b.blocked = p_user_id)
       or (b.blocker = p_user_id and b.blocked = v_me)
  ) then return null; end if;

  select p.id, p.name, p.username, p.bio, p.university, p.year, p.role,
         p.avatar_path, p.created_at, p.department_id,
         d.name as department, d.faculty
    into v_person
    from public.profiles p
    left join public.departments d on d.id = p.department_id
   where p.id = p_user_id;
  if not found then return null; end if;

  select department_id into v_me_department from public.profiles where id = v_me;
  if v_person.role = 'student' and (select role from public.profiles where id = v_me) = 'student' then
    select case
      when f.status = 'accepted' then 'friend'
      when f.status = 'pending' and f.requester = v_me then 'sent'
      when f.status = 'pending' then 'received'
      else 'none'
    end into v_relation
    from public.friendships f
    where (f.requester = v_me and f.addressee = p_user_id)
       or (f.requester = p_user_id and f.addressee = v_me)
    limit 1;
    v_relation := coalesce(v_relation, 'none');
  end if;

  return jsonb_build_object(
    'id', v_person.id,
    'name', v_person.name,
    'username', v_person.username,
    'bio', coalesce(v_person.bio, ''),
    'university', v_person.university,
    'department', v_person.department,
    'faculty', v_person.faculty,
    'year', v_person.year,
    'role', v_person.role,
    'avatar_path', v_person.avatar_path,
    'member_since', v_person.created_at,
    'relation', v_relation,
    'post_count', (
      select count(*)::integer from public.posts p
      where p.author_id = p_user_id
        and (p.is_public = true or p.department_id = v_me_department)
    )
  );
end;
$$;

revoke all on function public.get_public_profile(uuid) from public, anon;
grant execute on function public.get_public_profile(uuid) to authenticated;

-- Append the author's username and avatar to the existing feed view.
create or replace view public.feed_posts
with (security_invoker = true) as
select
  p.id, p.content, p.is_public, p.like_count, p.created_at,
  p.department_id, d.name as department, p.author_id,
  pr.name as author_name, pr.role as author_role, p.image_path,
  (select count(*)::integer from public.post_comments c where c.post_id = p.id) as comment_count,
  pr.username as author_username,
  pr.avatar_path as author_avatar_path
from public.posts p
join public.profiles pr on pr.id = p.author_id
join public.departments d on d.id = p.department_id;

grant select on public.feed_posts to authenticated;

create or replace view public.feed_post_comments
with (security_invoker = true) as
select c.id, c.post_id, c.author_id, c.content, c.created_at,
       pr.name as author_name, pr.role as author_role,
       pr.username as author_username, pr.avatar_path as author_avatar_path
from public.post_comments c
join public.profiles pr on pr.id = c.author_id;

grant select on public.feed_post_comments to authenticated;

-- Keep the feed fresh across devices. Supabase Realtime applies the table RLS policies.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'posts') then
      execute 'alter publication supabase_realtime add table public.posts';
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'post_comments') then
      execute 'alter publication supabase_realtime add table public.post_comments';
    end if;
  end if;
end;
$$;
