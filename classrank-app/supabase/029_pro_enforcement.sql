-- 029: Enforce Pro in the DATABASE (not just the app screens).
-- Run after 028_pro_codes.sql. Safe to run more than once.
--
-- Result: a student without active Pro gets the error "PRO_REQUIRED" from every feature function, and sees no rows from
-- quiz / feed / chat / course tables, even if they bypass the app and call Supabase directly.
-- Teachers and admins are never blocked. Free for everyone: profile, sign-up, Help & feedback, paying/redeeming a code,
-- blocking/reporting, push tokens, leaderboards.

-- ─────────────────────────────────────────────
-- 1. The check
-- ─────────────────────────────────────────────
create or replace function is_pro_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid()
      and (p.role in ('teacher', 'admin') or (p.is_pro and p.pro_expires_at > now()))
  );
$$;

create or replace function require_pro() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;   -- server-side jobs; the function's own auth checks still apply
  if not is_pro_active() then
    raise exception 'PRO_REQUIRED: Subscribe to Pro or enter a code to use this feature';
  end if;
end;
$$;

revoke all on function is_pro_active(), require_pro() from public;
grant execute on function is_pro_active(), require_pro() to authenticated;

-- ─────────────────────────────────────────────
-- 2. Add the check to the start of every feature function.
--    (Re-creates each function with `perform require_pro();` as its first statement; existing permissions are kept.
--     Functions already patched are skipped, so re-running is harmless.)
-- ─────────────────────────────────────────────
do $$
declare
  names text[] := array[
    'add_group_member','challenge_standings','complete_topic','course_daily_quiz','course_leaderboard','create_group_challenge',
    'create_group_post','create_group_quiz','create_post','create_post_reply','create_study_group','current_group_challenge',
    'delete_group_post','delete_group_quiz','delete_post','delete_study_group','get_course_content','get_group_quiz',
    'get_my_liked_post_ids','group_members_list','group_quiz_standings','join_course','join_study_group','leave_course',
    'leave_study_group','list_conversation','list_course_exams','list_group_messages','list_group_posts','list_group_quizzes',
    'list_post_replies','mark_conversation_read','mark_material_read','my_conversations','my_courses','my_friends',
    'my_recent_announcements','my_study_groups','remove_friend','report_challenge_progress','report_course_answers',
    'respond_friend_request','review_course_exam','review_group_quiz','search_people','send_direct_message','send_friend_request',
    'send_group_message','start_course_exam','submit_course_daily_answer','submit_course_exam','submit_group_quiz',
    'submit_single_answer','toggle_post_like'
  ];
  r record; newdef text; patched int := 0; found_names text[] := '{}';
begin
  for r in
    select p.oid, p.proname, l.lanname, pg_get_functiondef(p.oid) as def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where n.nspname = 'public' and p.prokind = 'f' and p.proname = any (names)
  loop
    found_names := found_names || r.proname;
    if r.def like '%require_pro()%' then continue; end if;
    if r.lanname <> 'plpgsql' then
      raise notice 'NOT PATCHED % (language %): add "perform require_pro();" by hand', r.proname, r.lanname;
      continue;
    end if;
    newdef := regexp_replace(r.def, '\mbegin\M', E'begin\n  perform require_pro();', 'i');   -- first BEGIN only
    begin
      execute newdef;
      patched := patched + 1;
    exception when others then
      raise notice 'NOT PATCHED % : %', r.proname, sqlerrm;
    end;
  end loop;
  raise notice 'Pro check added to % function(s).', patched;
  raise notice 'Not found in this database (fine if you never ran that migration): %', (select array_agg(x) from unnest(names) x where x <> all (found_names));
end $$;

-- ─────────────────────────────────────────────
-- 3. Block direct reads of tables and views
-- ─────────────────────────────────────────────
-- Today's quiz questions (a view): no rows without Pro.
create or replace view quiz_questions_public as
select id, department_id, quiz_date, question, options
from quiz_questions
where is_pro_active();
grant select on quiz_questions_public to authenticated;

-- Tables: an extra RESTRICTIVE policy that must pass on top of the existing rules. (This also stops live chat updates
-- from reaching a student whose Pro has ended.)
do $$
declare t text;
begin
  foreach t in array array[
    'quiz_attempts','posts','post_likes','direct_messages','group_messages','group_posts','group_replies',
    'course_materials','course_questions','course_events','course_answer_events','group_challenges','group_challenge_progress'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists "pro required" on public.%I', t);
      execute format('create policy "pro required" on public.%I as restrictive for select to authenticated using (is_pro_active())', t);
    else
      raise notice 'Table % not found, skipped', t;
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────
-- To switch enforcement off again (keeps everything else):
--   create or replace function require_pro() returns void language plpgsql as $f$ begin return; end $f$;
--   create or replace function is_pro_active() returns boolean language sql stable as $f$ select true $f$;
-- ─────────────────────────────────────────────
