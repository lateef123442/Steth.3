-- 048: Add comments to the department/campus feed.
-- Apply after 047_account_usernames.sql.

create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (char_length(trim(content)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists idx_post_comments_post_created
  on public.post_comments(post_id, created_at asc);

alter table public.post_comments enable row level security;

drop policy if exists "comments visible with their feed post" on public.post_comments;
create policy "comments visible with their feed post"
  on public.post_comments for select to authenticated
  using (exists (
    select 1 from public.posts p
    where p.id = post_comments.post_id
      and (p.is_public = true or p.department_id = (
        select pr.department_id from public.profiles pr where pr.id = auth.uid()
      ))
  ));

create or replace view public.feed_post_comments
with (security_invoker = true) as
select c.id, c.post_id, c.author_id, c.content, c.created_at,
       pr.name as author_name, pr.role as author_role, pr.username as author_username
from public.post_comments c
join public.profiles pr on pr.id = c.author_id;

grant select on public.feed_post_comments to authenticated;

create or replace view public.feed_posts
with (security_invoker = true) as
select
  p.id, p.content, p.is_public, p.like_count, p.created_at,
  p.department_id, d.name as department, p.author_id,
  pr.name as author_name, pr.role as author_role, p.image_path,
  (select count(*)::integer from public.post_comments c where c.post_id = p.id) as comment_count
from public.posts p
join public.profiles pr on pr.id = p.author_id
join public.departments d on d.id = p.department_id;

grant select on public.feed_posts to authenticated;

create or replace function public.create_post_comment(p_post_id uuid, p_content text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_comment public.post_comments%rowtype;
  v_visible boolean;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if char_length(trim(coalesce(p_content, ''))) < 1 or char_length(trim(p_content)) > 1000 then
    raise exception 'Comment must be between 1 and 1000 characters';
  end if;
  select exists (
    select 1 from public.posts p
    where p.id = p_post_id
      and (p.is_public = true or p.department_id = (
        select pr.department_id from public.profiles pr where pr.id = v_uid
      ))
  ) into v_visible;
  if not v_visible then raise exception 'Post not found'; end if;

  insert into public.post_comments(post_id, author_id, content)
  values (p_post_id, v_uid, trim(p_content))
  returning * into v_comment;

  return jsonb_build_object(
    'id', v_comment.id, 'post_id', v_comment.post_id, 'author_id', v_comment.author_id,
    'content', v_comment.content, 'created_at', v_comment.created_at,
    'author_name', (select name from public.profiles where id = v_uid),
    'author_role', (select role from public.profiles where id = v_uid),
    'author_username', (select username from public.profiles where id = v_uid)
  );
end;
$$;

revoke all on function public.create_post_comment(uuid, text) from public, anon;
grant execute on function public.create_post_comment(uuid, text) to authenticated;
