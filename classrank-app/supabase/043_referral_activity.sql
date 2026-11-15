-- Referral activity: show the referrer which accounts actually signed up with their code.
-- The existing profiles.referred_by relationship remains the source of truth.

create or replace function public.get_my_referral_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
  v_code text;
  v_total_referred int;
  v_total_rewarded int;
  v_recent_referrals jsonb;
begin
  if v_caller_id is null then
    raise exception 'Not authenticated';
  end if;

  select referral_code into v_code
  from public.profiles
  where id = v_caller_id;

  select count(*) into v_total_referred
  from public.profiles
  where referred_by = v_caller_id;

  select count(*) into v_total_rewarded
  from public.profiles
  where referred_by = v_caller_id and referral_rewarded = true;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', recent.id,
        'name', coalesce(nullif(trim(recent.name), ''), 'New student'),
        'created_at', recent.created_at
      ) order by recent.created_at desc
    ),
    '[]'::jsonb
  ) into v_recent_referrals
  from (
    select p.id, p.name, p.created_at
    from public.profiles p
    where p.referred_by = v_caller_id
    order by p.created_at desc
    limit 10
  ) recent;

  return jsonb_build_object(
    'referral_code', v_code,
    'total_referred', v_total_referred,
    'total_rewarded', v_total_rewarded,
    'recent_referrals', v_recent_referrals
  );
end;
$$;

revoke all on function public.get_my_referral_stats() from public;
grant execute on function public.get_my_referral_stats() to authenticated;
