-- 035: (1) push notifications server setup, (2) optional course thumbnails, (3) invite codes that give 1 month of Pro.
-- Run AFTER 034_course_sharing.sql. Safe to run more than once.

-- ═════════════════════════════════════════════
-- 1. PUSH NOTIFICATIONS (the parts of 013 + 019 that may never have been run, plus a recipients fix)
-- ═════════════════════════════════════════════
alter table profiles add column if not exists expo_push_token text;

do $$
begin
  if to_regclass('public.course_events') is not null then
    execute 'alter table course_events add column if not exists notified_at timestamptz';
  end if;
  if to_regclass('public.group_replies') is not null then
    execute 'alter table group_replies add column if not exists notified_at timestamptz';
  end if;
end;
$$;

-- A token identifies a DEVICE: detach it from any other account first (shared phone / previous owner never signed out).
create or replace function register_push_token(p_token text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_token is null or char_length(p_token) not between 10 and 200 then raise exception 'Invalid push token'; end if;
  update profiles set expo_push_token = null where expo_push_token = p_token and id <> auth.uid();
  update profiles set expo_push_token = p_token where id = auth.uid();
end;
$$;

create or replace function clear_push_token()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  update profiles set expo_push_token = null where id = auth.uid();
end;
$$;

-- The notify Edge Function runs with the service role. Announcements must reach EVERYONE who can see the course
-- (their department + year, shared audiences and join-code members), not only join-code members.
grant execute on function course_roster(uuid) to service_role;

-- ═════════════════════════════════════════════
-- 2. COURSE THUMBNAILS (optional; set by the course's teacher or an admin; students just see them)
-- ═════════════════════════════════════════════
alter table courses add column if not exists thumbnail_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('course-thumbnails', 'course-thumbnails', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Files live in <course id>/<file>. Only that course's staff may add or delete them; anyone can view (public bucket).
drop policy if exists "course thumbs: staff upload" on storage.objects;
drop policy if exists "course thumbs: staff delete" on storage.objects;
create policy "course thumbs: staff upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'course-thumbnails'
    and case when (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$' then is_course_staff(((storage.foldername(name))[1])::uuid) else false end);
create policy "course thumbs: staff delete" on storage.objects for delete to authenticated
  using (bucket_id = 'course-thumbnails'
    and case when (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$' then is_course_staff(((storage.foldername(name))[1])::uuid) else false end);

-- p_path = null removes the thumbnail.
create or replace function staff_set_course_thumbnail(p_course_id uuid, p_path text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not is_course_staff(p_course_id) then raise exception 'Not authorized'; end if;
  if p_path is not null then
    if left(p_path, 37) <> p_course_id::text || '/' then raise exception 'Invalid picture path'; end if;
    if not exists (select 1 from storage.objects where bucket_id = 'course-thumbnails' and name = p_path) then
      raise exception 'The upload did not finish. Try again';
    end if;
  end if;
  update courses set thumbnail_path = p_path where id = p_course_id;
  return p_path;
end;
$$;

-- Course screens call this to show the picture (students of the course and its staff only).
create or replace function get_course_thumbnail(p_course_id uuid) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not (is_course_staff(p_course_id) or is_course_member(p_course_id)) then return null; end if;
  return (select thumbnail_path from courses where id = p_course_id);
end;
$$;

-- Course lists now include thumbnail_path. (my_courses keeps the Pro check from 029 and the sharing flag from 034.)
create or replace function staff_list_courses()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_role text;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select role into v_role from profiles where id = v_uid;
  if v_role not in ('teacher', 'admin') then raise exception 'Not authorized'; end if;
  return coalesce((
    select jsonb_agg(x order by x.year, x.code) from (
      select c.id, c.code, c.title, c.year, c.join_code, c.thumbnail_path, d.name as department, pr.name as teacher_name,
        (select count(*) from course_roster(c.id)) as member_count,
        (select count(*) from course_questions q where q.course_id = c.id) as question_count,
        (select count(*) from course_materials t where t.course_id = c.id) as material_count,
        (select count(*) from course_topics tp where tp.course_id = c.id) as topic_count,
        (select count(*) from course_shares sh where sh.course_id = c.id) as share_count
      from courses c
      join departments d on d.id = c.department_id
      join profiles pr on pr.id = c.created_by
      where v_role = 'admin' or c.created_by = v_uid
    ) x), '[]'::jsonb);
end;
$$;

create or replace function my_courses()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform require_pro();   -- the Pro check added by 029
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  return coalesce((
    select jsonb_agg(x order by x.code) from (
      select c.id, c.code, c.title, c.year, c.thumbnail_path, d.name as department, pr.name as teacher_name,
        (select count(*) from course_roster(c.id)) as member_count,
        (select min(e.event_date) from course_events e where e.course_id = c.id and e.kind = 'exam' and e.event_date >= current_date) as next_exam,
        (select count(*) from course_topics t where t.course_id = c.id) as topic_count,
        (select count(*) from course_topic_progress g where g.course_id = c.id and g.profile_id = auth.uid()) as topics_done,
        (not exists (select 1 from profiles me where me.id = auth.uid() and me.department_id = c.department_id and me.year = c.year)
         and exists (select 1 from course_shares s join profiles me on me.id = auth.uid()
                      where s.course_id = c.id and s.department_id = me.department_id and (s.year is null or s.year = me.year))) as shared_with_me
      from courses c
      join departments d on d.id = c.department_id
      join profiles pr on pr.id = c.created_by
      where is_course_member(c.id)
    ) x), '[]'::jsonb);
end;
$$;

-- ═════════════════════════════════════════════
-- 3. INVITE CODES: whoever uses a student's code gets 1 month of Pro, and each account can use a code ONLY ONCE, ever.
--    (The inviter keeps the existing reward: +100 points once the friend has studied on 3 different days.)
-- ═════════════════════════════════════════════
alter table profiles add column if not exists referral_redeemed_at timestamptz;

-- One row per account that has used an invite code. The primary key is what makes "only once" a hard rule.
create table if not exists referral_redemptions (
  redeemer_id uuid primary key references profiles (id) on delete cascade,
  referrer_id uuid references profiles (id) on delete set null,
  code text not null,
  pro_days int not null default 30,
  redeemed_at timestamptz not null default now()
);
alter table referral_redemptions enable row level security;   -- no client policies: functions only
revoke all on referral_redemptions from anon, authenticated;

-- Accounts that already signed up with a code count as "used" (they get no retroactive Pro).
insert into referral_redemptions (redeemer_id, referrer_id, code, pro_days, redeemed_at)
select p.id, p.referred_by, coalesce((select r.referral_code from profiles r where r.id = p.referred_by), ''), 0, coalesce(p.created_at, now())
from profiles p where p.referred_by is not null
on conflict (redeemer_id) do nothing;

-- Internal helper: records the redemption and adds 30 days of Pro. Returns the new expiry, or null if this account
-- had already used a code. Not callable by clients.
create or replace function apply_referral_reward(p_redeemer uuid, p_referrer uuid, p_code text) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v_exp timestamptz; v_rows int;
begin
  insert into referral_redemptions (redeemer_id, referrer_id, code, pro_days) values (p_redeemer, p_referrer, p_code, 30)
  on conflict (redeemer_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return null; end if;
  update profiles
     set referred_by = coalesce(referred_by, p_referrer),
         referral_redeemed_at = now(),
         is_pro = true,
         pro_expires_at = greatest(coalesce(pro_expires_at, now()), now()) + interval '30 days'
   where id = p_redeemer
   returning pro_expires_at into v_exp;
  return v_exp;
end;
$$;
revoke all on function apply_referral_reward(uuid, uuid, text) from public, anon, authenticated;

-- Sign-up with an invite code: same as 014, plus the Pro month for the NEW account.
create or replace function complete_student_signup(
  p_name text, p_university text, p_department_id uuid, p_year int, p_referral_code text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_caller_id uuid := auth.uid();
  v_referrer_id uuid;
  v_existed boolean;
  v_code text := upper(trim(coalesce(p_referral_code, '')));
  v_exp timestamptz;
begin
  if v_caller_id is null then raise exception 'Not authenticated'; end if;
  v_existed := exists (select 1 from profiles where id = v_caller_id);

  if v_code <> '' then
    select id into v_referrer_id from profiles where referral_code = v_code;
    if v_referrer_id = v_caller_id then v_referrer_id := null; end if;   -- can't refer yourself
  end if;

  insert into profiles (id, name, university, department_id, year, role, referred_by)
  values (v_caller_id, trim(p_name), trim(p_university), p_department_id, p_year, 'student', v_referrer_id)
  on conflict (id) do update set
    name = excluded.name, university = excluded.university, department_id = excluded.department_id, year = excluded.year;
  -- referred_by is deliberately not updated on conflict: a code is captured once, at first creation.

  if v_referrer_id is not null and not v_existed then
    v_exp := apply_referral_reward(v_caller_id, v_referrer_id, v_code);
  end if;
  return jsonb_build_object('success', true, 'referral_applied', v_exp is not null, 'pro_expires_at', v_exp);
end;
$$;

-- Use a code AFTER sign-up (e.g. someone who skipped the box, or opened an invite link later).
create or replace function redeem_referral_code(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_role text;
  v_referrer uuid;
  v_exp timestamptz;
  v_used text := 'You''ve already used an invite code. Each account can use one only once.';
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select role into v_role from profiles where id = v_uid;
  if v_role is distinct from 'student' then return jsonb_build_object('ok', false, 'error', 'Invite codes are for student accounts.'); end if;

  if exists (select 1 from referral_redemptions where redeemer_id = v_uid)
     or exists (select 1 from profiles where id = v_uid and referred_by is not null) then
    return jsonb_build_object('ok', false, 'error', v_used);
  end if;

  if (select count(*) from pro_code_attempts where user_id = v_uid and at > now() - interval '15 minutes') >= 8 then
    return jsonb_build_object('ok', false, 'error', 'Too many wrong attempts. Please wait 15 minutes and try again.');
  end if;

  select id into v_referrer from profiles where referral_code = v_code and v_code <> '';
  if v_referrer is null or v_referrer = v_uid then
    insert into pro_code_attempts (user_id) values (v_uid);
    return jsonb_build_object('ok', false, 'error', 'That invite code isn''t valid.');
  end if;

  v_exp := apply_referral_reward(v_uid, v_referrer, v_code);
  if v_exp is null then return jsonb_build_object('ok', false, 'error', v_used); end if;
  return jsonb_build_object('ok', true, 'pro_expires_at', v_exp, 'days', 30);
end;
$$;

-- Referral numbers for the Profile screen, now also telling the app whether this account has used a code.
create or replace function get_my_referral_stats()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_caller_id uuid := auth.uid(); v_code text; v_total_referred int; v_total_rewarded int;
begin
  if v_caller_id is null then raise exception 'Not authenticated'; end if;
  select referral_code into v_code from profiles where id = v_caller_id;
  select count(*) into v_total_referred from profiles where referred_by = v_caller_id;
  select count(*) into v_total_rewarded from profiles where referred_by = v_caller_id and referral_rewarded = true;
  return jsonb_build_object(
    'referral_code', v_code,
    'total_referred', v_total_referred,
    'total_rewarded', v_total_rewarded,
    'has_redeemed', exists (select 1 from referral_redemptions where redeemer_id = v_caller_id)
                    or exists (select 1 from profiles where id = v_caller_id and referred_by is not null));
end;
$$;

-- ═════════════════════════════════════════════
-- Who may call what
-- ═════════════════════════════════════════════
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array['register_push_token', 'clear_push_token', 'staff_set_course_thumbnail', 'get_course_thumbnail',
                                 'staff_list_courses', 'my_courses', 'complete_student_signup', 'redeem_referral_code', 'get_my_referral_stats'])
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
