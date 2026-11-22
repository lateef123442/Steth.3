-- Teacher course details and safe bulk question import.
-- Run after 044_study_ai_quota.sql.

create or replace function staff_update_course_details(
  p_course_id uuid,
  p_code text,
  p_title text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_code text := upper(trim(coalesce(p_code, '')));
  v_title text := trim(coalesce(p_title, ''));
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not is_course_staff(p_course_id) then raise exception 'Not authorized to edit this course'; end if;
  if char_length(v_code) not between 2 and 20 then raise exception 'Course code must be between 2 and 20 characters'; end if;
  if char_length(v_title) not between 2 and 120 then raise exception 'Course name must be between 2 and 120 characters'; end if;
  update courses set code = v_code, title = v_title where id = p_course_id;
  if not found then raise exception 'Course not found'; end if;
end;
$$;

create or replace function staff_save_questions_bulk(
  p_course_id uuid,
  p_purpose text,
  p_questions jsonb
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_item jsonb;
  v_topic_id uuid;
  v_question text;
  v_options jsonb;
  v_correct integer;
  v_count integer;
  v_index integer := 0;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not is_course_staff(p_course_id) then raise exception 'Not authorized to add questions to this course'; end if;
  if p_purpose not in ('practice', 'daily', 'assessment') then raise exception 'Unknown question type'; end if;
  if p_questions is null or jsonb_typeof(p_questions) <> 'array' then raise exception 'The question batch is invalid'; end if;
  v_count := jsonb_array_length(p_questions);
  if v_count < 1 then raise exception 'Add at least one question'; end if;
  if v_count > 500 then raise exception 'Import up to 500 questions at a time'; end if;

  -- Validate every row before inserting anything. PostgreSQL executes this function
  -- in one transaction, so a failed batch never leaves a partial import behind.
  for v_item in select value from jsonb_array_elements(p_questions) loop
    v_index := v_index + 1;
    v_question := trim(coalesce(v_item->>'question', ''));
    v_options := v_item->'options';
    v_correct := nullif(v_item->>'correct_index', '')::integer;
    if char_length(v_question) not between 1 and 600 then
      raise exception 'Question %: question text must contain 1 to 600 characters', v_index;
    end if;
    if coalesce(jsonb_typeof(v_options), '') <> 'array' then
      raise exception 'Question %: options must be an array', v_index;
    end if;
    if jsonb_array_length(v_options) <> 4 then
      raise exception 'Question %: exactly four options are required', v_index;
    end if;
    if exists (select 1 from jsonb_array_elements_text(v_options) as opt(value) where char_length(trim(opt.value)) = 0) then
      raise exception 'Question %: all four options must contain text', v_index;
    end if;
    if v_correct is null or v_correct not between 0 and 3 then raise exception 'Question %: choose a correct answer from A to D', v_index; end if;
    if char_length(coalesce(v_item->>'explanation', '')) > 1000 then raise exception 'Question %: explanation is too long (maximum 1000 characters)', v_index; end if;
    if nullif(v_item->>'topic_id', '') is not null then
      v_topic_id := (v_item->>'topic_id')::uuid;
      if not exists (select 1 from course_topics where id = v_topic_id and course_id = p_course_id) then
        raise exception 'Question %: the selected topic does not belong to this course', v_index;
      end if;
    end if;
  end loop;

  insert into course_questions (course_id, topic, topic_id, purpose, question, options, correct_index, explanation, created_by)
  select p_course_id,
         coalesce(t.title, ''),
         nullif(x.topic_id, '')::uuid,
         p_purpose,
         trim(x.question),
         array(select jsonb_array_elements_text(x.options)),
         x.correct_index,
         coalesce(trim(x.explanation), ''),
         auth.uid()
    from jsonb_to_recordset(p_questions) as x(topic_id text, question text, options jsonb, correct_index integer, explanation text)
    left join course_topics t on t.id = nullif(x.topic_id, '')::uuid and t.course_id = p_course_id;

  return v_count;
end;
$$;

revoke all on function staff_update_course_details(uuid, text, text) from public;
grant execute on function staff_update_course_details(uuid, text, text) to authenticated;
revoke all on function staff_save_questions_bulk(uuid, text, jsonb) from public;
grant execute on function staff_save_questions_bulk(uuid, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
