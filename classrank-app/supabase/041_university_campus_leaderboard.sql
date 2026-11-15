-- 041: University-scoped leaderboards and live friend-request updates.
-- Apply after 016_subscriptions.sql and 026_social_chat_avatars.sql.
-- Existing leaderboard columns are preserved in order; university is appended.

create or replace view public.leaderboard as
select
  p.id,
  p.name,
  p.total_points as points,
  d.name as department,
  d.faculty as faculty,
  p.is_pro,
  p.university
from public.profiles p
join public.departments d on d.id = p.department_id
where p.shadow_flagged = false;

create or replace view public.leaderboard_normalized as
select
  p.id,
  p.name,
  p.total_points as points,
  d.name as department,
  d.faculty as faculty,
  case
    when count(*) over (partition by p.department_id) = 1 then 1.0
    else percent_rank() over (partition by p.department_id order by p.total_points asc)
  end as department_percentile,
  p.is_pro,
  p.university
from public.profiles p
join public.departments d on d.id = p.department_id
where p.shadow_flagged = false;

-- Realtime subscriptions must be allowed to read only the signed-in user's own friendship rows.
drop policy if exists "friendships: participants can read own requests" on public.friendships;
create policy "friendships: participants can read own requests"
on public.friendships for select to authenticated
using (requester = auth.uid() or addressee = auth.uid());

-- Friend request and acceptance events are used to refresh the Requests/Friends tabs live.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.friendships;
    exception when duplicate_object then null; end;
  end if;
end;
$$;

notify pgrst, 'reload schema';
