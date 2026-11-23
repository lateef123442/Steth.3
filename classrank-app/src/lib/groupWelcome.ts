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

let groupWelcomeSubscriptionSequence = 0;

export function subscribeGroupWelcomeNotifications(profileId: string, onChange: () => void, scope = "badge") {
  // Supabase channel names are shared by the client. A duplicate name can return an
  // already-subscribed channel; calling .on() on it throws. Give every live listener
  // its own channel while still registering handlers before subscribe().
  const channelName = `group-welcome:${profileId}:${scope}:${++groupWelcomeSubscriptionSequence}`;
  const channel = supabase.channel(channelName)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "group_welcome_notifications", filter: `profile_id=eq.${profileId}` }, onChange)
    .subscribe();
  return () => { void supabase.removeChannel(channel); };
}
