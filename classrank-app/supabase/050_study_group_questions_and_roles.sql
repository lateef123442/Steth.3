-- 050: owner-managed study groups and standalone group CBT questions.
-- Apply after 049_social_profiles_feed.sql.

alter table public.group_members
  add column if not exists group_role text not null default 'member'
  check (group_role in ('member', 'admin'));

create table if not exists public.group_questions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.study_groups(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  question text not null check (char_length(trim(question)) between 1 and 1000),
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) = 4),
  correct_option smallint not null check (correct_option between 0 and 3),
  created_at timestamptz not null default now()
);
create index if not exists idx_group_questions_group on public.group_questions(group_id, created_at desc);

create table if not exists public.group_question_answers (
  question_id uuid not null references public.group_questions(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  selected_option smallint not null check (selected_option between 0 and 3),
  is_correct boolean not null,
  answered_at timestamptz not null default now(),
  primary key (question_id, profile_id)
);
create index if not exists idx_group_question_answers_question on public.group_question_answers(question_id, answered_at);

alter table public.group_questions enable row level security;
alter table public.group_question_answers enable row level security;
-- No direct table policies: all reads/writes go through the security-definer RPCs.

create table if not exists public.group_join_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.study_groups(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  unique (group_id, profile_id)
);
alter table public.group_join_requests enable row level security;

create table if not exists public.group_activity (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.study_groups(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type in ('joined','left','admin_added','admin_removed')),
  created_at timestamptz not null default now()
);
create index if not exists idx_group_activity_group on public.group_activity(group_id, created_at desc);
alter table public.group_activity enable row level security;

create or replace function public.is_group_manager(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from study_groups g where g.id = p_group and g.owner_id = auth.uid()
  ) or exists (
    select 1 from group_members m where m.group_id = p_group
      and m.profile_id = auth.uid() and m.group_role = 'admin'
  );
$$;

create or replace function public.set_group_admin(p_group_id uuid, p_user_id uuid, p_make_admin boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from study_groups where id = p_group_id and owner_id = auth.uid()) then
    raise exception 'Only the group owner can appoint or remove admins';
  end if;
  if p_user_id = auth.uid() then raise exception 'The owner already has full group permissions'; end if;
  if not exists (select 1 from group_members where group_id = p_group_id and profile_id = p_user_id) then
    raise exception 'That person is not a member of this group';
  end if;
  update group_members set group_role = case when p_make_admin then 'admin' else 'member' end
    where group_id = p_group_id and profile_id = p_user_id;
  insert into group_activity(group_id, profile_id, event_type)
    values (p_group_id, p_user_id, case when p_make_admin then 'admin_added' else 'admin_removed' end);
end;
$$;

create or replace function public.create_group_question(
  p_group_id uuid, p_question text, p_options jsonb, p_correct_option int
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_group_member(p_group_id) or not is_group_manager(p_group_id) then
    raise exception 'Only the group owner or an appointed admin can create questions';
  end if;
  if (select count(*) from group_questions where group_id = p_group_id and created_at > now() - interval '1 minute') >= 10 then
    raise exception 'Please wait a moment before creating another question';
  end if;
  if char_length(trim(coalesce(p_question,''))) not between 1 and 1000
     or p_correct_option is null or p_correct_option not between 0 and 3 then
    raise exception 'Enter a question, four options and one correct answer';
  end if;
  if jsonb_typeof(p_options) is distinct from 'array' then
    raise exception 'A question needs exactly four options';
  end if;
  if jsonb_array_length(p_options) <> 4 then
    raise exception 'A question needs exactly four options';
  end if;
  if exists (select 1 from jsonb_array_elements(p_options) x where jsonb_typeof(x) is distinct from 'string' or char_length(trim(x #>> '{}')) = 0 or char_length(x #>> '{}') > 300) then
    raise exception 'Each option must contain 1 to 300 characters';
  end if;
  insert into group_questions(group_id, created_by, question, options, correct_option)
    values (p_group_id, auth.uid(), trim(p_question), p_options, p_correct_option)
    returning id into v_id;
  insert into group_messages(group_id, author_id, body)
    values (p_group_id, auth.uid(), '[[STETH_GROUP_QUESTION:' || v_id::text || ']]');
  return v_id;
end;
$$;

create or replace function public.submit_group_question_answer(p_question_id uuid, p_option int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_q group_questions; v_correct boolean;
begin
  select * into v_q from group_questions where id = p_question_id;
  if not found or not is_group_member(v_q.group_id) then raise exception 'Question not found'; end if;
  if p_option is null or p_option not between 0 and 3 then raise exception 'Choose one of the four options'; end if;
  v_correct := (p_option = v_q.correct_option);
  insert into group_question_answers(question_id, profile_id, selected_option, is_correct)
    values (p_question_id, auth.uid(), p_option, v_correct);
  return jsonb_build_object('selected_option', p_option, 'is_correct', v_correct);
exception when unique_violation then
  raise exception 'Your first answer is locked. You cannot answer this question again';
end;
$$;

create or replace function public.list_group_questions(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_group_member(p_group_id) then raise exception 'Not a member of this group'; end if;
  return coalesce((
    select jsonb_agg(x order by x.created_at desc) from (
      select q.id, q.question, q.options, q.created_at, q.created_by,
        pr.name as author_name,
        mine.selected_option as my_answer,
        mine.is_correct as my_is_correct,
        case when mine.profile_id is not null then q.correct_option else null end as correct_option,
        (select count(*) from group_question_answers a where a.question_id = q.id) as answered_count,
        (select count(*) from group_question_answers a where a.question_id = q.id and a.is_correct) as correct_count,
        (select count(*) from group_question_answers a where a.question_id = q.id and not a.is_correct) as incorrect_count,
        (select coalesce(jsonb_agg(jsonb_build_object(
          'profile_id', a.profile_id, 'name', p.name, 'selected_option', a.selected_option,
          'is_correct', a.is_correct, 'answered_at', a.answered_at
        ) order by a.answered_at), '[]'::jsonb)
          from group_question_answers a join profiles p on p.id = a.profile_id where a.question_id = q.id
        ) as answers
      from group_questions q
      join profiles pr on pr.id = q.created_by
      left join group_question_answers mine on mine.question_id = q.id and mine.profile_id = auth.uid()
      where q.group_id = p_group_id
      order by q.created_at desc limit 100
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.my_unanswered_group_questions_count()
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::integer from group_questions q
  join group_members m on m.group_id = q.group_id and m.profile_id = auth.uid()
  left join group_question_answers a on a.question_id = q.id and a.profile_id = auth.uid()
  where a.profile_id is null;
$$;

create or replace function public.request_group_join(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_group study_groups; v_id uuid;
begin
  select * into v_group from study_groups where join_code = upper(trim(p_code));
  if not found then raise exception 'No group matches that code'; end if;
  if exists (select 1 from group_members where group_id = v_group.id and profile_id = auth.uid()) then
    return jsonb_build_object('status','member','group_id',v_group.id,'name',v_group.name);
  end if;
  insert into group_join_requests(group_id,profile_id,status)
    values(v_group.id,auth.uid(),'pending')
    on conflict(group_id,profile_id) do update set status='pending',created_at=now(),reviewed_by=null,reviewed_at=null
    returning id into v_id;
  return jsonb_build_object('status','pending','request_id',v_id,'name',v_group.name);
end;
$$;

create or replace function public.list_group_join_requests(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_group_manager(p_group_id) then raise exception 'Only the owner or an appointed admin can review join requests'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id',r.id,'profile_id',p.id,'name',p.name,'department',d.name,'year',p.year,'avatar_path',p.avatar_path,'created_at',r.created_at) order by r.created_at)
    from group_join_requests r join profiles p on p.id=r.profile_id left join departments d on d.id=p.department_id
    where r.group_id=p_group_id and r.status='pending'
  ),'[]'::jsonb);
end;
$$;

create or replace function public.review_group_join_request(p_request_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_req group_join_requests; v_group study_groups;
begin
  select * into v_req from group_join_requests where id=p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if not is_group_manager(v_req.group_id) then raise exception 'Not authorized'; end if;
  if v_req.status <> 'pending' then raise exception 'This request has already been reviewed'; end if;
  update group_join_requests set status=case when p_approve then 'approved' else 'rejected' end,
    reviewed_by=auth.uid(), reviewed_at=now() where id=p_request_id;
  if p_approve then
    insert into group_members(group_id,profile_id) values(v_req.group_id,v_req.profile_id) on conflict do nothing;
    insert into group_activity(group_id,profile_id,event_type) values(v_req.group_id,v_req.profile_id,'joined');
  end if;
end;
$$;

create or replace function public.list_group_activity(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_group_manager(p_group_id) then raise exception 'Only the owner or an appointed admin can view group activity'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('profile_id',a.profile_id,'name',p.name,'event_type',a.event_type,'created_at',a.created_at) order by a.created_at desc)
    from group_activity a left join profiles p on p.id=a.profile_id where a.group_id=p_group_id limit 100
  ),'[]'::jsonb);
end;
$$;

create or replace function public.leave_study_group(p_group_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if exists(select 1 from study_groups where id=p_group_id and owner_id=auth.uid()) then
    raise exception 'The owner must delete the group or transfer ownership before leaving';
  end if;
  delete from group_members where group_id=p_group_id and profile_id=auth.uid();
  if found then
    insert into group_activity(group_id,profile_id,event_type) values(p_group_id,auth.uid(),'left');
  end if;
end;
$$;

-- Existing members who join through the old invite-code flow are still admitted immediately.
-- Record the join so the owner/admin activity view can show it.
create or replace function public.join_study_group(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_group study_groups; v_added integer := 0;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select * into v_group from study_groups where join_code=upper(trim(p_code));
  if not found then raise exception 'No group matches that code'; end if;
  if (select count(*) from group_members where group_id=v_group.id)>=200 then raise exception 'This group is full'; end if;
  insert into group_members(group_id,profile_id) values(v_group.id,v_uid) on conflict do nothing;
  get diagnostics v_added = row_count;
  if v_added > 0 then insert into group_activity(group_id,profile_id,event_type) values(v_group.id,v_uid,'joined'); end if;
  return jsonb_build_object('group_id',v_group.id,'name',v_group.name);
end;
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=any(array[
      'is_group_manager','set_group_admin','create_group_question','submit_group_question_answer',
      'list_group_questions','my_unanswered_group_questions_count','request_group_join',
      'list_group_join_requests','review_group_join_request','list_group_activity',
      'leave_study_group','join_study_group'
    ])
  loop
    execute format('revoke all on function %s from public',r.sig);
    execute format('grant execute on function %s to authenticated',r.sig);
  end loop;
end;
$$;
