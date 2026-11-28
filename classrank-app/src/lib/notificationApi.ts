import { supabase } from "./supabase";

export type AppNotificationKind = "announcement" | "direct_message" | "group_message" | "friend_request" | "friend_request_accepted" | "admin_request" | "admin_reply";
export interface AppNotification {
  id: string;
  kind: AppNotificationKind;
  title: string;
  body: string;
  data: Record<string, any>;
  created_at: string;
  read_at: string | null;
  actor_name?: string | null;
}

export async function fetchMyNotifications(): Promise<AppNotification[]> {
  const { data, error } = await supabase.rpc("my_notifications", { p_limit: 75 });
  if (error) throw error;
  return (data ?? []) as AppNotification[];
}

export async function fetchMyUnreadNotificationCount(): Promise<number> {
  const { data, error } = await supabase.rpc("my_unread_notification_count");
  if (error) throw error;
  return Number(data) || 0;
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase.rpc("mark_notification_read", { p_notification_id: id });
  if (error) throw error;
}

export async function markAllNotificationsRead(): Promise<void> {
  const { error } = await supabase.rpc("mark_all_notifications_read");
  if (error) throw error;
}

export async function sendTeacherAnnouncement(title: string, body: string): Promise<{ announcement_id: string; recipient_count: number }> {
  const { data, error } = await supabase.rpc("send_teacher_announcement", { p_title: title, p_body: body });
  if (error) throw error;
  const result = data as { announcement_id: string; recipient_count: number };
  // The persistent inbox is already written by the RPC; push delivery is best-effort.
  try { await supabase.functions.invoke("notify", { body: { kind: "teacher_announcement", announcementId: result.announcement_id } }); } catch { /* inbox notification remains available */ }
  return result;
}

let subscriptionSequence = 0;
export function subscribeMyNotifications(profileId: string, onChange: () => void) {
  const channel = supabase.channel(`steth-user-notifications:${profileId}:${++subscriptionSequence}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "user_notifications", filter: `recipient_id=eq.${profileId}` }, onChange)
    .subscribe();
  return () => { void supabase.removeChannel(channel); };
}
