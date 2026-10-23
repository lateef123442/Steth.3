-- 036: invite codes now give 7 days of Pro to BOTH people:
--   * the friend who uses the code, and
--   * the student who shared it (their Pro is extended by 7 days, every time a friend uses their code).
-- Run AFTER 035_notifications_thumbnails_invites.sql. Safe to run more than once.
-- (The existing "+100 points once the friend has studied on 3 different days" bonus for the inviter is unchanged.)

alter table referral_redemptions add column if not exists referrer_pro_days int not null default 0;
alter table referral_redemptions alter column pro_days set default 7;

-- Internal helper: records the redemption, gives the new user 7 days and the inviter 7 days.
-- Returns the new user's Pro expiry, or null if this account had already used a code. Not callable by clients.
create or replace function apply_referral_reward(p_redeemer uuid, p_referrer uuid, p_code text) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v_exp timestamptz; v_rows int;
begin
  insert into referral_redemptions (redeemer_id, referrer_id, code, pro_days, referrer_pro_days)
  values (p_redeemer, p_referrer, p_code, 7, 7)
  on conflict (redeemer_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return null; end if;   -- this account has already used an invite code

  update profiles
     set referred_by = coalesce(referred_by, p_referrer),
         referral_redeemed_at = now(),
         is_pro = true,
         pro_expires_at = greatest(coalesce(pro_expires_at, now()), now()) + interval '7 days'
   where id = p_redeemer
   returning pro_expires_at into v_exp;

  -- the person who shared the code (students only; teachers and admins already have full access)
  update profiles
     set is_pro = true,
         pro_expires_at = greatest(coalesce(pro_expires_at, now()), now()) + interval '7 days'
   where id = p_referrer and role = 'student';

  return v_exp;
end;
$$;
revoke all on function apply_referral_reward(uuid, uuid, text) from public, anon, authenticated;

-- Same checks as before; the answer now says 7 days.
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
  return jsonb_build_object('ok', true, 'pro_expires_at', v_exp, 'days', 7);
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'redeem_referral_code'
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
