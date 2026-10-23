-- 037: teachers can rename an uploaded file resource and move it to another topic (notes, links and videos were
-- already editable through staff_save_material). Safe to run more than once.
create or replace function staff_edit_file_material(p_id uuid, p_title text, p_topic_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_course uuid; v_topic text := '';
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select course_id into v_course from course_materials where id = p_id;
  if v_course is null then raise exception 'Resource not found'; end if;
  if not is_course_staff(v_course) then raise exception 'Not authorized'; end if;
  if p_title is null or char_length(trim(p_title)) = 0 then raise exception 'Give the resource a name'; end if;
  if char_length(trim(p_title)) > 200 then raise exception 'That name is too long'; end if;
  if p_topic_id is not null then
    select title into v_topic from course_topics where id = p_topic_id and course_id = v_course;
    if v_topic is null then raise exception 'Topic not found'; end if;
  end if;
  update course_materials set title = trim(p_title), topic_id = p_topic_id, topic = v_topic where id = p_id;
end;
$$;

revoke all on function staff_edit_file_material(uuid, text, uuid) from public;
grant execute on function staff_edit_file_material(uuid, text, uuid) to authenticated;

notify pgrst, 'reload schema';
