-- 062: reserve a group quiz attempt when the student confirms, persist each choice,
-- and score an unfinished attempt when the student exits and later reopens the quiz.

create table if not exists public.group_quiz_attempts (
  quiz_id uuid not null references public.group_quizzes(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  answers jsonb not null default '[]'::jsonb,
  submitted_at timestamptz,
  correct int check (correct is null or correct >= 0),
  total int check (total is null or total > 0),
  seconds int not null default 0 check (seconds >= 0),
  primary key (quiz_id, profile_id),
  check (jsonb_typeof(answers) = 'array')
);

alter table public.group_quiz_attempts enable row level security;

-- Preserve completed one-time attempts made before this migration.
insert into public.group_quiz_attempts
  (quiz_id, profile_id, started_at, answers, submitted_at, correct, total, seconds)
select quiz_id, profile_id, created_at, '[]'::jsonb, created_at, correct, total, seconds
from public.group_quiz_results
on conflict (quiz_id, profile_id) do nothing;

create or replace function public.start_group_quiz(p_quiz_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_quiz public.group_quizzes;
  v_answers jsonb;
  v_inserted int;
  v_started_at timestamptz := now();
begin
  select * into v_quiz from public.group_quizzes where id = p_quiz_id;
  if not found or not public.is_group_member(v_quiz.group_id) then raise exception 'Quiz not found'; end if;
  select coalesce(jsonb_agg('null'::jsonb order by gs.n), '[]'::jsonb)
    into v_answers from generate_series(0, jsonb_array_length(v_quiz.questions) - 1) as gs(n);
  insert into public.group_quiz_attempts (quiz_id, profile_id, started_at, answers)
  values (p_quiz_id, auth.uid(), v_started_at, v_answers)
  on conflict (quiz_id, profile_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then raise exception 'You have already taken this quiz'; end if;
  return jsonb_build_object(
    'attempt_started_at', v_started_at,
    'questions', (select jsonb_agg(jsonb_build_object('q', e->>'q', 'options', e->'options') order by n)
      from jsonb_array_elements(v_quiz.questions) with ordinality as t(e, n))
  );
end;
$$;

create or replace function public.get_group_quiz(p_quiz_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_quiz public.group_quizzes;
  v_attempt public.group_quiz_attempts;
  v_result public.group_quiz_results;
  v_has_attempt boolean := false;
  v_has_result boolean := false;
  v_total int;
  v_correct int;
  v_seconds int;
begin
  select * into v_quiz from public.group_quizzes where id = p_quiz_id;
  if not found or not public.is_group_member(v_quiz.group_id) then raise exception 'Quiz not found'; end if;
  select * into v_attempt from public.group_quiz_attempts where quiz_id = p_quiz_id and profile_id = auth.uid();
  v_has_attempt := found;

  -- Re-opening an unfinished attempt finalizes it. Saved answers count; unanswered questions are wrong.
  if v_has_attempt and v_attempt.submitted_at is null then
    v_total := jsonb_array_length(v_quiz.questions);
    select count(*) into v_correct
    from jsonb_array_elements(v_quiz.questions) with ordinality as t(e, n)
    where (v_attempt.answers -> (n::int - 1)) = to_jsonb((e->>'correct')::int);
    v_seconds := least(86400, greatest(0, floor(extract(epoch from (now() - v_attempt.started_at)))::int));
    update public.group_quiz_attempts set submitted_at = now(), correct = v_correct, total = v_total, seconds = v_seconds
    where quiz_id = p_quiz_id and profile_id = auth.uid() and submitted_at is null;
    insert into public.group_quiz_results (quiz_id, profile_id, correct, total, seconds)
    values (p_quiz_id, auth.uid(), v_correct, v_total, v_seconds)
    on conflict (quiz_id, profile_id) do nothing;
    select * into v_attempt from public.group_quiz_attempts where quiz_id = p_quiz_id and profile_id = auth.uid();
  end if;

  select * into v_result from public.group_quiz_results where quiz_id = p_quiz_id and profile_id = auth.uid();
  v_has_result := found;
  return jsonb_build_object(
    'id', v_quiz.id,
    'title', v_quiz.title,
    'taken', (v_has_attempt or v_has_result),
    'my_answers', case when v_has_attempt then v_attempt.answers else null end,
    'result', case when v_has_result then jsonb_build_object('correct', v_result.correct, 'total', v_result.total) else null end,
    'questions', case when v_has_attempt or v_has_result then '[]'::jsonb else (
      select jsonb_agg(jsonb_build_object('q', e->>'q', 'options', e->'options') order by n)
      from jsonb_array_elements(v_quiz.questions) with ordinality as t(e, n)
    ) end
  );
end;
$$;

create or replace function public.save_group_quiz_answer(p_quiz_id uuid, p_question_index int, p_picked int)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_quiz public.group_quizzes;
  v_attempt public.group_quiz_attempts;
  v_total int;
begin
  select * into v_quiz from public.group_quizzes where id = p_quiz_id;
  if not found or not public.is_group_member(v_quiz.group_id) then raise exception 'Quiz not found'; end if;
  v_total := jsonb_array_length(v_quiz.questions);
  if p_question_index is null or p_question_index < 0 or p_question_index >= v_total then raise exception 'Question not found'; end if;
  if p_picked is null or p_picked not between 0 and 3 then raise exception 'Choose one of the four options'; end if;
  select * into v_attempt from public.group_quiz_attempts
    where quiz_id = p_quiz_id and profile_id = auth.uid() for update;
  if not found then raise exception 'Confirm Start quiz before answering'; end if;
  if v_attempt.submitted_at is not null then raise exception 'You have already taken this quiz'; end if;
  update public.group_quiz_attempts
  set answers = jsonb_set(answers, array[p_question_index::text], to_jsonb(p_picked), true)
  where quiz_id = p_quiz_id and profile_id = auth.uid();
end;
$$;

create or replace function public.submit_group_quiz(p_quiz_id uuid, p_answers jsonb, p_seconds int default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_quiz public.group_quizzes;
  v_attempt public.group_quiz_attempts;
  v_total int;
  v_correct int;
  v_seconds int;
begin
  select * into v_quiz from public.group_quizzes where id = p_quiz_id;
  if not found or not public.is_group_member(v_quiz.group_id) then raise exception 'Quiz not found'; end if;
  v_total := jsonb_array_length(v_quiz.questions);
  if jsonb_typeof(p_answers) is distinct from 'array' then raise exception 'Answers do not match the quiz'; end if;
  if jsonb_array_length(p_answers) <> v_total then raise exception 'Answers do not match the quiz'; end if;
  if exists (select 1 from jsonb_array_elements(p_answers) as a(value)
    where a.value <> 'null'::jsonb and coalesce(a.value #>> '{}', '') !~ '^[0-3]$') then
    raise exception 'One or more answers are invalid';
  end if;
  select * into v_attempt from public.group_quiz_attempts
    where quiz_id = p_quiz_id and profile_id = auth.uid() for update;

  if not found then
    raise exception 'Confirm Start quiz before submitting';
  end if;
  if v_attempt.submitted_at is not null then
    return jsonb_build_object('correct', v_attempt.correct, 'total', v_attempt.total);
  end if;
  select count(*) into v_correct
  from jsonb_array_elements(v_quiz.questions) with ordinality as t(e, n)
  where (v_attempt.answers -> (n::int - 1)) = to_jsonb((e->>'correct')::int);
  v_seconds := least(86400, greatest(0, floor(extract(epoch from (now() - v_attempt.started_at)))::int));
  update public.group_quiz_attempts set submitted_at = now(), correct = v_correct, total = v_total, seconds = v_seconds
  where quiz_id = p_quiz_id and profile_id = auth.uid();
  insert into public.group_quiz_results (quiz_id, profile_id, correct, total, seconds)
  values (p_quiz_id, auth.uid(), v_correct, v_total, v_seconds)
  on conflict (quiz_id, profile_id) do nothing;
  return jsonb_build_object('correct', v_correct, 'total', v_total);
end;
$$;

create or replace function public.finalize_group_quiz(p_quiz_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_state jsonb;
begin
  v_state := public.get_group_quiz(p_quiz_id);
  if coalesce((v_state->>'taken')::boolean, false) is not true or jsonb_typeof(v_state->'result') <> 'object' then
    raise exception 'No started attempt was found';
  end if;
  return v_state->'result';
end;
$$;

revoke all on function public.start_group_quiz(uuid) from public, anon;
revoke all on function public.get_group_quiz(uuid) from public, anon;
revoke all on function public.save_group_quiz_answer(uuid, int, int) from public, anon;
revoke all on function public.submit_group_quiz(uuid, jsonb, int) from public, anon;
revoke all on function public.finalize_group_quiz(uuid) from public, anon;
grant execute on function public.start_group_quiz(uuid) to authenticated;
grant execute on function public.get_group_quiz(uuid) to authenticated;
grant execute on function public.save_group_quiz_answer(uuid, int, int) to authenticated;
grant execute on function public.submit_group_quiz(uuid, jsonb, int) to authenticated;
grant execute on function public.finalize_group_quiz(uuid) to authenticated;
