-- 060: Require a short, server-graded knowledge check before a student can finish a course topic.
-- Run after 025_levels_topics_assessments.sql. No client can read answer keys or mark a topic complete directly.

create table if not exists public.course_topic_completion_attempts (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.course_topics(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  question_ids uuid[] not null check (cardinality(question_ids) = 10),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  submitted_at timestamptz,
  score smallint check (score between 0 and 10),
  passed boolean,
  created_at timestamptz not null default now()
);

create index if not exists idx_topic_completion_attempt_owner
  on public.course_topic_completion_attempts(profile_id, topic_id, created_at desc);

create unique index if not exists uq_topic_completion_active_attempt
  on public.course_topic_completion_attempts(profile_id, topic_id)
  where submitted_at is null;

alter table public.course_topic_completion_attempts enable row level security;
revoke all on public.course_topic_completion_attempts from anon, authenticated;

-- Start a fresh ten-question attempt. The answer key is never returned to the app.
create or replace function public.start_topic_completion_quiz(p_topic_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_topic public.course_topics%rowtype;
  v_unread int;
  v_question_ids uuid[];
  v_attempt_id uuid;
  v_questions jsonb;
  v_count int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into v_topic from public.course_topics where id = p_topic_id;
  if not found or not is_course_member(v_topic.course_id) then
    raise exception 'Topic not found';
  end if;

  if exists (
    select 1 from public.course_topic_progress
    where topic_id = p_topic_id and profile_id = v_uid
  ) then
    raise exception 'This topic is already complete';
  end if;

  select count(*) into v_unread
  from public.course_materials m
  where m.topic_id = p_topic_id
    and not exists (
      select 1 from public.course_material_reads r
      where r.material_id = m.id and r.profile_id = v_uid
    );
  if v_unread > 0 then
    raise exception 'Open every resource in this topic first (% left)', v_unread;
  end if;

  select array_agg(q.id order by q.random_order)
  into v_question_ids
  from (
    select id, random() as random_order
    from public.course_questions
    where course_id = v_topic.course_id
      and topic_id = p_topic_id
      and purpose = 'practice'
    order by random()
    limit 10
  ) q;

  v_count := coalesce(cardinality(v_question_ids), 0);
  if v_count < 10 then
    raise exception 'This topic needs 10 published practice questions. Your teacher has added % so far.', v_count;
  end if;

  -- Starting again closes any abandoned attempt for this topic.
  update public.course_topic_completion_attempts
  set submitted_at = now()
  where profile_id = v_uid and topic_id = p_topic_id and submitted_at is null;

  insert into public.course_topic_completion_attempts(topic_id, course_id, profile_id, question_ids)
  values (p_topic_id, v_topic.course_id, v_uid, v_question_ids)
  returning id into v_attempt_id;

  select coalesce(jsonb_agg(
    jsonb_build_object('id', q.id, 'question', q.question, 'options', q.options)
    order by array_position(v_question_ids, q.id)
  ), '[]'::jsonb)
  into v_questions
  from public.course_questions q
  where q.id = any(v_question_ids);

  return jsonb_build_object(
    'attempt_id', v_attempt_id,
    'topic_title', v_topic.title,
    'questions', v_questions
  );
end;
$$;

-- Grade the exact ten questions issued for this attempt. Seven correct answers are required.
create or replace function public.submit_topic_completion_quiz(
  p_attempt_id uuid,
  p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_attempt public.course_topic_completion_attempts%rowtype;
  v_score int;
  v_passed boolean;
  v_course_complete boolean := false;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) <> 10 then
    raise exception 'Answer all 10 questions before submitting';
  end if;

  select * into v_attempt
  from public.course_topic_completion_attempts
  where id = p_attempt_id and profile_id = v_uid
  for update;

  if not found then raise exception 'Quiz attempt not found'; end if;
  if v_attempt.submitted_at is not null then raise exception 'This quiz attempt has already been submitted'; end if;
  if v_attempt.expires_at < now() then raise exception 'This quiz has expired. Start a new attempt'; end if;
  if not is_course_member(v_attempt.course_id) then raise exception 'Not authorized'; end if;

  if (
    select count(distinct (a.value->>'question_id')::uuid)
    from jsonb_array_elements(p_answers) a
  ) <> 10 then
    raise exception 'Each question must have one answer';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_answers) a
    where not ((a.value->>'question_id')::uuid = any(v_attempt.question_ids))
       or coalesce((a.value->>'picked')::int, -1) not between 0 and 3
  ) then
    raise exception 'The submitted answers do not match this quiz';
  end if;

  if exists (
    select 1
    from unnest(v_attempt.question_ids) expected(id)
    where not exists (
      select 1 from jsonb_array_elements(p_answers) a
      where (a.value->>'question_id')::uuid = expected.id
    )
  ) then
    raise exception 'Answer every question in this quiz';
  end if;

  select count(*) into v_score
  from jsonb_array_elements(p_answers) a
  join public.course_questions q on q.id = (a.value->>'question_id')::uuid
  where q.id = any(v_attempt.question_ids)
    and q.correct_index = (a.value->>'picked')::int;

  v_passed := v_score >= 7;

  update public.course_topic_completion_attempts
  set submitted_at = now(), score = v_score, passed = v_passed
  where id = v_attempt.id;

  if v_passed then
    insert into public.course_topic_progress(topic_id, profile_id, course_id)
    values (v_attempt.topic_id, v_uid, v_attempt.course_id)
    on conflict (topic_id, profile_id) do nothing;

    v_course_complete := course_completed(v_attempt.course_id, v_uid);
  end if;

  return jsonb_build_object(
    'score', v_score,
    'total', 10,
    'pass_mark', 7,
    'passed', v_passed,
    'course_complete', v_course_complete
  );
end;
$$;

-- Remove the old direct-completion path. Only a passed assessment may create progress.
revoke all on function public.complete_topic(uuid) from public, anon, authenticated;
revoke all on function public.start_topic_completion_quiz(uuid) from public, anon;
revoke all on function public.submit_topic_completion_quiz(uuid, jsonb) from public, anon;
grant execute on function public.start_topic_completion_quiz(uuid) to authenticated;
grant execute on function public.submit_topic_completion_quiz(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
