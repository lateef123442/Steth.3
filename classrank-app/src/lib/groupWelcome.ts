import { supabase } from "./supabase";

export interface GroupWelcomeNotification {
  id: string;
  group_id: string;
  group_name: string;
  title: string;
  body: string;
  created_at: string;
}

export async function fetchMyGroupWelcomeNotifications(): Promise<GroupWelcomeNotification[]> {
  const { data, error } = await supabase.rpc("my_group_welcome_notifications");
  if (error) throw error;
  return (data ?? []) as GroupWelcomeNotification[];
}

export async function markGroupWelcomeNotificationRead(id: string): Promise<void> {
  const { error } = await supabase.rpc("mark_group_welcome_notification_read", { p_notification_id: id });
  if (error) throw error;
}

export function subscribeGroupWelcomeNotifications(profileId: string, onChange: () => void, scope = "badge") {
  const channel = supabase.channel("group-welcome:" + profileId + ":" + scope)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "group_welcome_notifications", filter: `profile_id=eq.${profileId}` }, onChange)
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
