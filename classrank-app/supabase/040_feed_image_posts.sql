-- 040: Allow feed posts to contain text, an image, or both.
-- Apply after 039_streak_and_points_for_all_study.sql.

alter table public.posts add column if not exists image_path text;

-- Image-only posts are valid; keep the existing 1,000-character caption limit.
alter table public.posts drop constraint if exists posts_content_check;
alter table public.posts add constraint posts_content_check
  check (char_length(trim(coalesce(content, ''))) <= 1000);

create or replace view public.feed_posts
with (security_invoker = true) as
select
  p.id,
  p.content,
  p.is_public,
  p.like_count,
  p.created_at,
  p.department_id,
  d.name as department,
  p.author_id,
  pr.name as author_name,
  pr.role as author_role,
  p.image_path
from public.posts p
join public.profiles pr on pr.id = p.author_id
join public.departments d on d.id = p.department_id;

grant select on public.feed_posts to authenticated;

-- Replace the original two-argument RPC with an optional image path argument.
drop function if exists public.create_post(text, boolean);
create or replace function public.create_post(
  p_content text,
  p_is_public boolean default false,
  p_image_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
  v_department_id uuid;
  v_id uuid;
begin
  if v_caller_id is null then raise exception 'Not authenticated'; end if;
  select department_id into v_department_id from profiles where id = v_caller_id;
  if v_department_id is null then raise exception 'Only students and teachers with a department can post'; end if;
  if char_length(trim(coalesce(p_content, ''))) > 1000 then raise exception 'Post must be at most 1000 characters'; end if;
  if char_length(trim(coalesce(p_content, ''))) = 0 and p_image_path is null then raise exception 'Add some text or a photo before posting'; end if;
  if p_image_path is not null and split_part(p_image_path, '/', 1) <> v_caller_id::text then
    raise exception 'Invalid image path';
  end if;
  insert into posts (author_id, department_id, content, is_public, image_path)
  values (v_caller_id, v_department_id, trim(coalesce(p_content, '')), coalesce(p_is_public, false), p_image_path)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.create_post(text, boolean, text) from public;
grant execute on function public.create_post(text, boolean, text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-images', 'post-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "Users upload their own feed images" on storage.objects;
create policy "Users upload their own feed images" on storage.objects
for insert to authenticated
with check (bucket_id = 'post-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users delete their own feed images" on storage.objects;
create policy "Users delete their own feed images" on storage.objects
for delete to authenticated
using (bucket_id = 'post-images' and (storage.foldername(name))[1] = auth.uid()::text);
