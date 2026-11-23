import { supabase } from "./supabase";

const call = async <T>(fn: string, args?: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
};

export type GroupQuestionAnswer = {
  profile_id: string;
  name: string;
  selected_option: number;
  is_correct: boolean;
  answered_at: string;
};
export type GroupQuestion = {
  id: string;
  question: string;
  options: string[];
  created_at: string;
  created_by: string;
  author_name: string;
  my_answer: number | null;
  my_is_correct: boolean | null;
  correct_option: number | null;
  answered_count: number;
  correct_count: number;
  incorrect_count: number;
  answers: GroupQuestionAnswer[];
};
export type GroupJoinRequest = {
  id: string;
  profile_id: string;
  name: string;
  department: string | null;
  year: number | null;
  avatar_path: string | null;
  created_at: string;
};
export type GroupActivity = {
  profile_id: string | null;
  name: string | null;
  event_type: "joined" | "left" | "admin_added" | "admin_removed";
  created_at: string;
};

export const createGroupQuestion = (groupId: string, question: string, options: string[], correctOption: number) =>
  call<string>("create_group_question", {
    p_group_id: groupId, p_question: question, p_options: options, p_correct_option: correctOption,
  });
export const submitGroupQuestionAnswer = (questionId: string, option: number) =>
  call<{ selected_option: number; is_correct: boolean }>("submit_group_question_answer", {
    p_question_id: questionId, p_option: option,
  });
export const fetchGroupQuestions = async (groupId: string) =>
  (await call<GroupQuestion[]>("list_group_questions", { p_group_id: groupId })) ?? [];
export const fetchUnansweredGroupQuestionCount = () =>
  call<number>("my_unanswered_group_questions_count");
export const setGroupAdmin = (groupId: string, userId: string, makeAdmin: boolean) =>
  call<void>("set_group_admin", { p_group_id: groupId, p_user_id: userId, p_make_admin: makeAdmin });
export const fetchGroupJoinRequests = async (groupId: string) =>
  (await call<GroupJoinRequest[]>("list_group_join_requests", { p_group_id: groupId })) ?? [];
export const reviewGroupJoinRequest = (requestId: string, approve: boolean) =>
  call<void>("review_group_join_request", { p_request_id: requestId, p_approve: approve });
export const fetchGroupActivity = async (groupId: string) =>
  (await call<GroupActivity[]>("list_group_activity", { p_group_id: groupId })) ?? [];
export const requestGroupJoin = (code: string) =>
  call<{ status: "member" | "pending"; request_id?: string; group_id?: string; name: string }>("request_group_join", { p_code: code });

export const fetchUnreadJoinedMemberCounts = async (): Promise<Record<string, number>> => {
  const rows = await call<Array<{ group_id: string; unread_count: number }>>("my_unread_group_join_counts");
  return Object.fromEntries((rows ?? []).map((r) => [r.group_id, Number(r.unread_count) || 0]));
};
export const markGroupJoinActivityRead = (groupId: string) =>
  call<void>("mark_group_join_activity_read", { p_group_id: groupId });
