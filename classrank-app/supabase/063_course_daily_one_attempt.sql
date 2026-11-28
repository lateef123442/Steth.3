-- 063: require explicit confirmation before a course daily quiz starts,
-- reserve one attempt per student/course/day, and prevent reopening after exit.

create table if not exists public.course_daily_quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  quiz_date date not null default current_date,
  question_ids uuid[] not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint course_daily_quiz_attempts_once unique (profile_id, course_id, quiz_date),
  constraint course_daily_quiz_attempts_questions_check check (cardinality(question_ids) >= 1)
);

create index if not exists idx_course_daily_quiz_attempts_course_date
  on public.course_daily_quiz_attempts (course_id, quiz_date);

alter table public.course_daily_quiz_attempts enable row level security;
revoke all on table public.course_daily_quiz_attempts from public, anon, authenticated;

-- Preserve existing daily answers as already-started attempts for their original date.
insert into public.course_daily_quiz_attempts (profile_id, course_id, quiz_date, question_ids)
select a.profile_id, a.course_id, a.answered_on, array_agg(a.question_id order by a.question_id)
from public.course_daily_answers a
group by a.profile_id, a.course_id, a.answered_on
on conflict (profile_id, course_id, quiz_date) do nothing;

-- Availability endpoint: metadata only. It intentionally never returns question text or options.
create or replace function public.course_daily_quiz(p_course_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_today int;
  v_pending int;
  v_available int;
  v_started boolean;
  v_completed boolean;
begin
  if not public.is_course_member(p_course_id) then raise exception 'Not authorized'; end if;

  select count(*) into v_today
  from public.course_daily_answers
  where profile_id = auth.uid() and course_id = p_course_id and answered_on = current_date;

  select count(*) into v_pending
  from public.course_questions q
  where q.course_id = p_course_id and q.purpose = 'daily'
    and not exists (
      select 1 from public.course_daily_answers a
      where a.question_id = q.id and a.profile_id = auth.uid()
    );

  select count(*) into v_available
  from public.course_questions q
  where q.course_id = p_course_id and q.purpose = 'daily'
    and not exists (
      select 1 from public.course_daily_answers a
      where a.question_id = q.id and a.profile_id = auth.uid()
    )
    and (q.topic_id is null or exists (
      select 1 from public.course_material_reads r
      join public.course_materials m on m.id = r.material_id
      where r.profile_id = auth.uid() and m.topic_id = q.topic_id
    ));

  select exists (
    select 1 from public.course_daily_quiz_attempts a
    where a.profile_id = auth.uid() and a.course_id = p_course_id and a.quiz_date = current_date
  ) into v_started;

  select coalesce((
    select a.completed_at is not null
    from public.course_daily_quiz_attempts a
    where a.profile_id = auth.uid() and a.course_id = p_course_id and a.quiz_date = current_date
  ), false) into v_completed;

  return jsonb_build_object(
    'answered_today', v_today,
    'daily_limit', 5,
    'pending_total', v_pending,
    'available_questions', case when v_started then 0 else least(greatest(0, 5 - v_today), v_available) end,
    'started_today', v_started,
    'completed_today', v_completed,
    'questions', '[]'::jsonb
  );
end;
$$;

-- Called only after the student taps "Yes, start quiz". This call permanently reserves today's attempt.
create or replace function public.start_course_daily_quiz(p_course_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_today int;
  v_limit int;
  v_questions jsonb;
  v_question_ids uuid[];
  v_attempt_id uuid;
begin
  if not public.is_course_member(p_course_id) then raise exception 'Not authorized'; end if;

  -- Serialize concurrent start requests for this student/course/day; the unique constraint is a second guard.
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text), hashtext(p_course_id::text || current_date::text));

  if exists (
    select 1 from public.course_daily_quiz_attempts a
    where a.profile_id = auth.uid() and a.course_id = p_course_id and a.quiz_date = current_date
  ) then
    return jsonb_build_object('already_started', true, 'questions', '[]'::jsonb);
  end if;

  select count(*) into v_today
  from public.course_daily_answers
  where profile_id = auth.uid() and course_id = p_course_id and answered_on = current_date;

  v_limit := greatest(0, 5 - v_today);
  if v_limit = 0 then
    return jsonb_build_object('already_started', false, 'questions', '[]'::jsonb);
  end if;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', chosen.id,
      'topic', chosen.topic,
      'question', chosen.question,
      'options', to_jsonb(chosen.options)
    ) order by chosen.position), '[]'::jsonb),
    coalesce(array_agg(chosen.id order by chosen.position), array[]::uuid[])
  into v_questions, v_question_ids
  from (
    select q.id, q.topic, q.question, q.options, row_number() over () as position
    from public.course_questions q
    where q.course_id = p_course_id and q.purpose = 'daily'
      and not exists (
        select 1 from public.course_daily_answers a
        where a.question_id = q.id and a.profile_id = auth.uid()
      )
      and (q.topic_id is null or exists (
        select 1 from public.course_material_reads r
        join public.course_materials m on m.id = r.material_id
        where r.profile_id = auth.uid() and m.topic_id = q.topic_id
      ))
    order by random()
    limit v_limit
  ) chosen;

  if cardinality(v_question_ids) = 0 then
    return jsonb_build_object('already_started', false, 'questions', '[]'::jsonb);
  end if;

  insert into public.course_daily_quiz_attempts (profile_id, course_id, quiz_date, question_ids)
  values (auth.uid(), p_course_id, current_date, v_question_ids)
  on conflict (profile_id, course_id, quiz_date) do nothing
  returning id into v_attempt_id;

  if v_attempt_id is null then
    return jsonb_build_object('already_started', true, 'questions', '[]'::jsonb);
  end if;

  return jsonb_build_object('already_started', false, 'questions', v_questions);
end;
$$;

-- Answers are accepted only for the exact question set reserved by today's confirmed attempt.
create or replace function public.submit_course_daily_answer(p_question_id uuid, p_picked int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_q public.course_questions;
  v_prev public.course_daily_answers;
  v_attempt public.course_daily_quiz_attempts;
  v_ok boolean;
  v_pts int := 0;
  v_total int;
  v_today int;
begin
  select * into v_q
  from public.course_questions
  where id = p_question_id and purpose = 'daily';

  if not found or not public.is_course_member(v_q.course_id) then raise exception 'Question not found'; end if;
  if p_picked is null or p_picked not between 0 and 3 then raise exception 'Pick one of the four options'; end if;

  select * into v_attempt
  from public.course_daily_quiz_attempts
  where profile_id = auth.uid() and course_id = v_q.course_id and quiz_date = current_date
    and p_question_id = any(question_ids)
  for update;

  if not found then raise exception 'Start today''s quiz before answering. This quiz cannot be reopened after it has been started'; end if;

  select * into v_prev
  from public.course_daily_answers
  where question_id = p_question_id and profile_id = auth.uid();

  if found then
    return jsonb_build_object(
      'already_answered', true,
      'is_correct', v_prev.correct,
      'correct_index', v_q.correct_index,
      'explanation', v_q.explanation,
      'points_earned', 0
    );
  end if;

  select count(*) into v_today
  from public.course_daily_answers
  where profile_id = auth.uid() and course_id = v_q.course_id and answered_on = current_date;

  if v_today >= 5 then raise exception 'You have finished today''s quiz for this course. Come back tomorrow'; end if;

  v_ok := (p_picked = v_q.correct_index);
  insert into public.course_daily_answers (question_id, profile_id, course_id, picked, correct)
  values (p_question_id, auth.uid(), v_q.course_id, p_picked, v_ok);

  if v_ok then
    v_pts := 10;
    update public.profiles set total_points = total_points + v_pts
    where id = auth.uid() returning total_points into v_total;
  end if;

  update public.course_daily_quiz_attempts a
  set completed_at = now()
  where a.id = v_attempt.id and a.completed_at is null
    and not exists (
      select 1
      from unnest(v_attempt.question_ids) as selected(question_id)
      where not exists (
        select 1 from public.course_daily_answers answer
        where answer.question_id = selected.question_id
          and answer.profile_id = auth.uid()
          and answer.answered_on = current_date
      )
    );

  return jsonb_build_object(
    'already_answered', false,
    'is_correct', v_ok,
    'correct_index', v_q.correct_index,
    'explanation', v_q.explanation,
    'points_earned', v_pts,
    'total_points', v_total
  );
end;
$$;

revoke all on function public.start_course_daily_quiz(uuid) from public, anon;
grant execute on function public.start_course_daily_quiz(uuid) to authenticated;
revoke all on function public.course_daily_quiz(uuid) from public, anon;
grant execute on function public.course_daily_quiz(uuid) to authenticated;
revoke all on function public.submit_course_daily_answer(uuid, int) from public, anon;
grant execute on function public.submit_course_daily_answer(uuid, int) to authenticated;
