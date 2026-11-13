-- 039: streaks and points now grow from ALL real study activity, not only the department daily quiz.
-- Run AFTER 029 and 034-038. Safe to run more than once.
--
-- Before this, only the department quiz (submit_single_answer) updated the streak. Students who spent their time on their
-- teachers' course quizzes, topics and exams earned some points but their streak never moved, and the app also never
-- refreshed the numbers on screen after those activities.
--
-- Now, any of these counts as a study day and keeps (or starts) the streak, with the SAME rules as the daily quiz
-- (miss a day and it restarts; Pro keeps a one-day Streak Shield):
--   * answering a course daily quiz question        (+5 points for trying, on top of the 10 for a correct answer)
--   * finishing a topic                              (+10 points, once per topic)
--   * submitting a test or exam                      (points per correct answer are unchanged)
--   * opening a course resource for the first time   (counts for the streak only)
--
-- Done with triggers on purpose: the existing functions stay exactly as they are, including the Pro checks that 029 added.

-- One shared rule for "this student studied today".
create or replace function bump_streak(p_profile uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_last date; v_streak int; v_pro boolean; v_grace int; v_new int;
begin
  select last_quiz_date, current_streak, is_pro into v_last, v_streak, v_pro from profiles where id = p_profile;
  if not found then return; end if;
  if v_last = current_date then return; end if;                      -- already counted today
  v_grace := case when v_pro and pro_expires_at_active(p_profile) then 2 else 1 end;
  if v_last is null or v_last < current_date - v_grace then
    v_new := 1;                                                       -- missed too many days: start again
  else
    v_new := coalesce(v_streak, 0) + 1;                               -- yesterday (or inside the Pro grace): keep going
  end if;
  update profiles set current_streak = v_new, last_quiz_date = current_date where id = p_profile;
end;
$$;
revoke all on function bump_streak(uuid) from public, anon, authenticated;

-- Course daily quiz: a study day, plus 5 points for trying (the department quiz also gives 5 for trying).
create or replace function trg_daily_answer_progress() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform bump_streak(new.profile_id);
  update profiles set total_points = total_points + 5 where id = new.profile_id;
  return new;
end;
$$;
drop trigger if exists trg_daily_answer_progress on course_daily_answers;
create trigger trg_daily_answer_progress after insert on course_daily_answers
  for each row execute function trg_daily_answer_progress();

-- Finishing a topic: a study day, plus 10 points the first time (the row is only created once per topic).
create or replace function trg_topic_done_progress() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform bump_streak(new.profile_id);
  update profiles set total_points = total_points + 10 where id = new.profile_id;
  return new;
end;
$$;
drop trigger if exists trg_topic_done_progress on course_topic_progress;
create trigger trg_topic_done_progress after insert on course_topic_progress
  for each row execute function trg_topic_done_progress();

-- Submitting a test or exam: a study day. (Its points are already added by submit_course_exam.)
create or replace function trg_exam_submit_progress() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform bump_streak(new.profile_id);
  return new;
end;
$$;
drop trigger if exists trg_exam_submit_progress on course_exam_attempts;
create trigger trg_exam_submit_progress after update of submitted_at on course_exam_attempts
  for each row when (old.submitted_at is null and new.submitted_at is not null)
  execute function trg_exam_submit_progress();

-- Opening a course resource for the first time: a study day.
create or replace function trg_material_read_progress() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform bump_streak(new.profile_id);
  return new;
end;
$$;
drop trigger if exists trg_material_read_progress on course_material_reads;
create trigger trg_material_read_progress after insert on course_material_reads
  for each row execute function trg_material_read_progress();

notify pgrst, 'reload schema';
