-- 028: Pro access by one-time code (bank-transfer payment).
-- Run after 001-027.
--
-- How it works
--   1. A student pays ₦999 (or more) by bank transfer and uploads the receipt in the app (pro_payment_requests +
--      private 'receipts' storage bucket). They also message the admin on WhatsApp.
--   2. An admin checks the receipt and generates a 13-character alphanumeric code (7 days or 30 days) — either
--      straight from the request ("Approve") or from the Codes tab — and sends it to the student on WhatsApp.
--   3. The student enters the code. redeem_pro_code() marks it USED (kept for the audit trail, never reusable) and
--      extends profiles.pro_expires_at. Codes can't be read or written by clients directly; only these functions can.
--
-- is_pro / pro_expires_at stay locked against client writes (see 016) — only the SECURITY DEFINER functions below
-- (and the RevenueCat webhook) change them.

-- ─────────────────────────────────────────────
-- Codes
-- ─────────────────────────────────────────────
create table if not exists pro_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{13}$'),
  duration_days int not null check (duration_days in (7, 30)),
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  used_by uuid references profiles (id) on delete set null,
  used_at timestamptz,
  check ((used_by is null) = (used_at is null) or used_by is null)  -- used_by may be nulled if the user is deleted
);
alter table pro_codes enable row level security;               -- no client policies: functions only
drop policy if exists "pro_codes: admins read" on pro_codes;
create policy "pro_codes: admins read" on pro_codes for select to authenticated using (is_admin());

-- Failed redemption attempts (brute-force throttle).
create table if not exists pro_code_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles (id) on delete cascade,
  at timestamptz not null default now()
);
create index if not exists pro_code_attempts_user_at on pro_code_attempts (user_id, at desc);
alter table pro_code_attempts enable row level security;       -- functions only

-- ─────────────────────────────────────────────
-- Payment requests (receipt uploads)
-- ─────────────────────────────────────────────
create table if not exists pro_payment_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  receipt_path text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  code_id uuid references pro_codes (id) on delete set null,
  admin_note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists pro_payment_requests_status on pro_payment_requests (status, created_at desc);
alter table pro_payment_requests enable row level security;
drop policy if exists "pay_req: own read" on pro_payment_requests;
drop policy if exists "pay_req: admins read" on pro_payment_requests;
create policy "pay_req: own read" on pro_payment_requests for select to authenticated using (user_id = auth.uid());
create policy "pay_req: admins read" on pro_payment_requests for select to authenticated using (is_admin());

-- Private bucket: students write/read only their own folder; admins can read everything.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "receipts: upload own" on storage.objects;
drop policy if exists "receipts: read own" on storage.objects;
drop policy if exists "receipts: admins read" on storage.objects;
create policy "receipts: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "receipts: read own" on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "receipts: admins read" on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and is_admin());

-- ─────────────────────────────────────────────
-- Helpers
-- ─────────────────────────────────────────────
-- 13 random characters from A-Z0-9, drawn from gen_random_uuid() (cryptographically strong).
create or replace function gen_pro_code() returns text
language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  bytes text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');  -- 64 hex chars
  out text := '';
  i int;
begin
  for i in 1..13 loop
    out := out || substr(alphabet, 1 + (get_byte(decode(substr(bytes, 2 * i - 1, 2), 'hex'), 0) % 36), 1);
  end loop;
  return out;
end;
$$;
revoke all on function gen_pro_code() from public;

create or replace function make_pro_code(p_days int, p_admin uuid) returns pro_codes
language plpgsql security definer set search_path = public as $$
declare r pro_codes;
begin
  loop
    begin
      insert into pro_codes (code, duration_days, created_by) values (gen_pro_code(), p_days, p_admin) returning * into r;
      return r;
    exception when unique_violation then null;  -- astronomically unlikely; draw again
    end;
  end loop;
end;
$$;
revoke all on function make_pro_code(int, uuid) from public;

-- ─────────────────────────────────────────────
-- Admin: generate / list / revoke codes
-- ─────────────────────────────────────────────
create or replace function admin_generate_pro_codes(p_duration_days int, p_count int default 1) returns jsonb
language plpgsql security definer set search_path = public as $$
declare out jsonb := '[]'::jsonb; r pro_codes; i int;
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  if p_duration_days not in (7, 30) then raise exception 'Duration must be 7 days or 30 days'; end if;
  if p_count < 1 or p_count > 50 then raise exception 'You can generate 1 to 50 codes at a time'; end if;
  for i in 1..p_count loop
    r := make_pro_code(p_duration_days, auth.uid());
    out := out || jsonb_build_array(jsonb_build_object('id', r.id, 'code', r.code, 'duration_days', r.duration_days, 'created_at', r.created_at));
  end loop;
  return out;
end;
$$;

-- p_status: 'all' | 'unused' | 'used'
create or replace function admin_list_pro_codes(p_status text default 'all', p_limit int default 100) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  return coalesce((
    select jsonb_agg(x order by (x->>'created_at') desc) from (
      select jsonb_build_object(
        'id', c.id, 'code', c.code, 'duration_days', c.duration_days, 'created_at', c.created_at,
        'used', c.used_at is not null, 'used_at', c.used_at, 'used_by', c.used_by, 'used_by_name', p.name) as x
      from pro_codes c left join profiles p on p.id = c.used_by
      where (p_status = 'all' or (p_status = 'used' and c.used_at is not null) or (p_status = 'unused' and c.used_at is null))
      order by c.created_at desc limit greatest(1, least(p_limit, 300))
    ) q), '[]'::jsonb);
end;
$$;

-- Only an unused code can be revoked; used ones are kept as a record.
create or replace function admin_revoke_pro_code(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  delete from pro_codes where id = p_id and used_at is null;
  if not found then raise exception 'That code was already used, so it can''t be removed'; end if;
end;
$$;

-- ─────────────────────────────────────────────
-- Student: redeem a code
-- ─────────────────────────────────────────────
-- Returns {ok:true, pro_expires_at, duration_days} or {ok:false, error}. Failures are returned (not raised) so the
-- attempt is still recorded for the throttle.
create or replace function redeem_pro_code(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  norm text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  c pro_codes;
  new_exp timestamptz;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if (select count(*) from pro_code_attempts where user_id = auth.uid() and at > now() - interval '15 minutes') >= 8 then
    return jsonb_build_object('ok', false, 'error', 'Too many wrong attempts. Please wait 15 minutes and try again.');
  end if;

  select * into c from pro_codes where code = norm for update;
  if not found or c.used_at is not null or char_length(norm) <> 13 then
    insert into pro_code_attempts (user_id) values (auth.uid());
    return jsonb_build_object('ok', false, 'error', 'That code isn''t valid or has already been used.');
  end if;

  update pro_codes set used_by = auth.uid(), used_at = now() where id = c.id;
  update profiles
     set is_pro = true,
         pro_expires_at = greatest(coalesce(pro_expires_at, now()), now()) + make_interval(days => c.duration_days)
   where id = auth.uid()
   returning pro_expires_at into new_exp;
  delete from pro_code_attempts where user_id = auth.uid();
  return jsonb_build_object('ok', true, 'pro_expires_at', new_exp, 'duration_days', c.duration_days);
end;
$$;

-- ─────────────────────────────────────────────
-- Student: submit a receipt; Admin: review it
-- ─────────────────────────────────────────────
create or replace function submit_payment_request(p_path text) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if left(p_path, char_length(auth.uid()::text) + 1) <> auth.uid()::text || '/' then raise exception 'Invalid receipt path'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'receipts' and name = p_path) then raise exception 'The upload did not finish. Try again'; end if;
  if (select count(*) from pro_payment_requests where user_id = auth.uid() and created_at > now() - interval '1 day') >= 5 then
    raise exception 'You''ve sent several receipts today. Please wait for the admin to reply on WhatsApp';
  end if;
  insert into pro_payment_requests (user_id, receipt_path) values (auth.uid(), p_path) returning id into rid;
  return rid;
end;
$$;

create or replace function my_payment_requests() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'status', status, 'created_at', created_at, 'admin_note', admin_note) order by created_at desc)
    from (select * from pro_payment_requests where user_id = auth.uid() order by created_at desc limit 10) q), '[]'::jsonb);
end;
$$;

-- p_status: 'pending' | 'approved' | 'rejected' | 'all'
create or replace function admin_list_payment_requests(p_status text default 'pending', p_limit int default 60) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  return coalesce((
    select jsonb_agg(x order by (x->>'created_at') desc) from (
      select jsonb_build_object(
        'id', r.id, 'user_id', r.user_id, 'name', p.name, 'email', u.email, 'department', d.name, 'year', p.year,
        'receipt_path', r.receipt_path, 'status', r.status, 'created_at', r.created_at, 'admin_note', r.admin_note,
        'code', c.code, 'duration_days', c.duration_days) as x
      from pro_payment_requests r
      join profiles p on p.id = r.user_id
      left join auth.users u on u.id = r.user_id
      left join departments d on d.id = p.department_id
      left join pro_codes c on c.id = r.code_id
      where (p_status = 'all' or r.status = p_status)
      order by r.created_at desc limit greatest(1, least(p_limit, 200))
    ) q), '[]'::jsonb);
end;
$$;

-- Approve = generate a code for this student's payment and link it, in one step.
create or replace function admin_approve_payment_request(p_id uuid, p_duration_days int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r pro_payment_requests; c pro_codes;
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  if p_duration_days not in (7, 30) then raise exception 'Duration must be 7 days or 30 days'; end if;
  select * into r from pro_payment_requests where id = p_id for update;
  if not found then raise exception 'Request not found'; end if;
  if r.status <> 'pending' then raise exception 'This request was already handled'; end if;
  c := make_pro_code(p_duration_days, auth.uid());
  update pro_payment_requests set status = 'approved', code_id = c.id, resolved_at = now() where id = p_id;
  return jsonb_build_object('id', c.id, 'code', c.code, 'duration_days', c.duration_days);
end;
$$;

create or replace function admin_reject_payment_request(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  update pro_payment_requests set status = 'rejected', admin_note = nullif(trim(coalesce(p_note, '')), ''), resolved_at = now()
   where id = p_id and status = 'pending';
  if not found then raise exception 'This request was already handled'; end if;
end;
$$;

-- ─────────────────────────────────────────────
-- Permissions + realtime (new receipts show up live for admins)
-- ─────────────────────────────────────────────
revoke all on function admin_generate_pro_codes(int, int), admin_list_pro_codes(text, int), admin_revoke_pro_code(uuid),
  redeem_pro_code(text), submit_payment_request(text), my_payment_requests(), admin_list_payment_requests(text, int),
  admin_approve_payment_request(uuid, int), admin_reject_payment_request(uuid, text) from public;
grant execute on function admin_generate_pro_codes(int, int), admin_list_pro_codes(text, int), admin_revoke_pro_code(uuid),
  redeem_pro_code(text), submit_payment_request(text), my_payment_requests(), admin_list_payment_requests(text, int),
  admin_approve_payment_request(uuid, int), admin_reject_payment_request(uuid, text) to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table pro_payment_requests; exception when duplicate_object then null; end;
  end if;
end $$;
