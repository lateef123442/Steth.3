import { supabase } from "./supabase";
import { Role } from "../types";

// Feedback inbox, moderation reports and teacher administration (supabase/027_moderation_feedback_admin.sql).
const call = async <T>(fn: string, args?: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
};

export type FeedbackCategory = "complaint" | "bug" | "suggestion" | "other";
export type FeedbackStatus = "open" | "in_progress" | "resolved";
export const CATEGORY_LABEL: Record<FeedbackCategory, string> = { complaint: "Complaint", bug: "Problem / bug", suggestion: "Suggestion", other: "Other" };
export const STATUS_LABEL: Record<FeedbackStatus, string> = { open: "Open", in_progress: "In progress", resolved: "Resolved" };
export interface MyFeedback { id: string; category: FeedbackCategory; subject: string; body: string; status: FeedbackStatus; admin_reply: string; replied_at: string | null; created_at: string }
export interface AdminFeedback extends MyFeedback { author_name: string; author_role: Role; department: string | null; year: number | null; email: string | null }

export const submitFeedback = (category: FeedbackCategory, subject: string, body: string) => call<string>("submit_feedback", { p_category: category, p_subject: subject, p_body: body });
export const fetchMyFeedback = async () => (await call<MyFeedback[]>("my_feedback")) ?? [];
export const fetchAdminFeedback = async (status: FeedbackStatus | "all" = "all") => (await call<AdminFeedback[]>("admin_list_feedback", { p_status: status, p_limit: 150 })) ?? [];
export const respondFeedback = (id: string, status: FeedbackStatus, reply: string) => call<void>("admin_respond_feedback", { p_id: id, p_status: status, p_reply: reply });

export type ReportStatus = "open" | "reviewing" | "resolved" | "dismissed";
export interface AdminReport {
  id: string; reporter_id: string | null; reported_id: string | null; reporter_name: string; reported_name: string; context: "direct" | "group" | "profile";
  snippet: string; reason: string; details: string; status: ReportStatus; admin_note: string; created_at: string; reports_against: number; suspended_until: string | null;
}
export const fetchReports = async (status: ReportStatus | "all" = "open") => (await call<AdminReport[]>("admin_list_reports", { p_status: status, p_limit: 100 })) ?? [];
export const updateReport = (id: string, status: ReportStatus, note: string) => call<void>("admin_update_report", { p_id: id, p_status: status, p_note: note });
export const suspendChat = (userId: string, days: number) => call<string | null>("admin_suspend_chat", { p_user: userId, p_days: days });
export const fetchInboxCounts = () => call<{ feedback: number; reports: number }>("admin_inbox_counts");

/** Fires whenever a feedback row or report is created or changed (RLS limits what each person receives). */
export function subscribeInbox(table: "feedback" | "reports", onChange: () => void) {
  const ch = supabase.channel(`inbox:${table}:${Math.random().toString(36).slice(2, 8)}`)
    .on("postgres_changes", { event: "*", schema: "public", table }, onChange).subscribe();
  return () => { supabase.removeChannel(ch); };
}

// ── admin: teachers ──
export const getTeacherDepartments = async (id: string) => (await call<string[] | null>("admin_get_teacher_departments", { p_teacher: id })) ?? [];
export const setTeacherDepartments = (id: string, departmentIds: string[]) => call<void>("admin_set_teacher_departments", { p_teacher: id, p_departments: departmentIds });
export const deleteUser = (id: string, courses: "transfer" | "delete" = "transfer") => call<void>("admin_delete_user", { p_user: id, p_courses: courses });
export const fetchMyTeachingDepartments = async () => (await call<{ id: string; name: string }[]>("my_teaching_departments")) ?? [];
