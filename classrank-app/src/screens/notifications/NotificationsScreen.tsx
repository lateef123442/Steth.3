import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing, type } from "../../theme/tokens";
import PressableScale from "../../components/animated/PressableScale";
import { AppNotification, fetchMyNotifications, markAllNotificationsRead, markNotificationRead, subscribeMyNotifications } from "../../lib/notificationApi";
import { useApp } from "../../context/AppContext";

const iconFor = (kind: string) => ({ announcement: "📣", direct_message: "💬", group_message: "👥", friend_request: "👋", friend_request_accepted: "🤝", admin_request: "📩", admin_reply: "🛟" } as Record<string,string>)[kind] ?? "🔔";
const when = (value: string) => {
  const date = new Date(value); const ms = Math.max(0, Date.now() - date.getTime());
  if (ms < 60_000) return "Just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return date.toLocaleDateString();
};

export default function NotificationsScreen({ navigation }: any) {
  const { profile } = useApp();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setItems(await fetchMyNotifications()); } catch { /* show the last successful inbox */ }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => {
    if (!profile?.id) return;
    void load();
    const stop = subscribeMyNotifications(profile.id, () => { void load(); });
    return stop;
  }, [profile?.id, load]);

  const open = async (item: AppNotification) => {
    if (!item.read_at) {
      setItems((old) => old.map((x) => x.id === item.id ? { ...x, read_at: new Date().toISOString() } : x));
      await markNotificationRead(item.id).catch(() => {});
    }
    const d = item.data ?? {};
    if (item.kind === "group_message" && d.group_id) navigation.navigate("GroupChat", { groupId: d.group_id, name: d.group_name ?? "Study group" });
    else if (item.kind === "direct_message" && d.sender_id) navigation.navigate("Chat", { userId: d.sender_id, name: item.actor_name ?? "Chat" });
    else if (item.kind === "friend_request") navigation.navigate("Friends", { initialTab: "Requests" });
    else if (item.kind === "friend_request_accepted") navigation.navigate("Friends", { initialTab: "Friends" });
    else if (item.kind === "admin_reply") navigation.navigate("Feedback");
    else if (item.kind === "admin_request" && profile?.role === "admin") navigation.navigate("Admin", { screen: "AdminInbox" });
    else if (item.kind === "announcement") navigation.navigate("Community");
  };

  const unread = items.filter((x) => !x.read_at).length;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl * 2 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Text style={[type.h1, { color: colors.ink }]}>Notifications</Text>
            <Text style={{ color: colors.textMuted, marginTop: 4 }}>{unread ? `${unread} unread notification${unread === 1 ? "" : "s"}` : "You're all caught up"}</Text>
          </View>
          {unread > 0 && <PressableScale disabled={busy} onPress={async () => { setBusy(true); try { await markAllNotificationsRead(); setItems((old) => old.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() }))); } finally { setBusy(false); } }} style={{ paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, backgroundColor: colors.tealTint }}><Text style={{ color: colors.teal, fontWeight: "800", fontSize: 12 }}>Mark all read</Text></PressableScale>}
        </View>
        {loading ? <ActivityIndicator color={colors.teal} style={{ marginTop: 32 }} /> : items.length === 0 ? (
          <View style={{ alignItems: "center", padding: 36, marginTop: 24, backgroundColor: colors.card, borderRadius: 18 }}><Text style={{ fontSize: 34 }}>🔔</Text><Text style={{ color: colors.ink, fontSize: 17, fontWeight: "800", marginTop: 12 }}>No notifications yet</Text><Text style={{ color: colors.textMuted, textAlign: "center", marginTop: 6 }}>Announcements, messages, friend requests and important updates will appear here.</Text></View>
        ) : items.map((item) => (
          <PressableScale key={item.id} onPress={() => open(item)} style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 15, marginTop: 10, borderRadius: 16, backgroundColor: item.read_at ? colors.card : colors.tealTint, borderWidth: 1, borderColor: item.read_at ? colors.border : colors.teal }}>
            <View style={{ width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.paper }}><Text style={{ fontSize: 20 }}>{iconFor(item.kind)}</Text></View>
            <View style={{ flex: 1 }}><View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><Text style={{ flex: 1, color: colors.ink, fontWeight: item.read_at ? "600" : "800" }}>{item.title}</Text>{!item.read_at && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger }} />}</View><Text style={{ color: colors.textMuted, fontSize: 13, lineHeight: 19, marginTop: 4 }}>{item.body}</Text><Text style={{ color: colors.textFaint, fontSize: 11, marginTop: 7 }}>{when(item.created_at)}</Text></View>
          </PressableScale>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
