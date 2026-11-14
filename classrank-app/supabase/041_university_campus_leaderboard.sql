-- 041: Add university scope to the Campus leaderboard.
-- Apply after the existing 002_normalized_leaderboard.sql migration.
-- Keep all existing view columns in their original order; append university.

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
  p.university as university
from public.profiles p
join public.departments d on d.id = p.department_id;
