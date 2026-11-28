import { useEffect } from "react";
import Notifications from "../lib/expoNotifications";
import type { NotificationResponse } from "expo-notifications";
import { useNavigation } from "@react-navigation/native";
import { useApp } from "../context/AppContext";
import { loadStudy, getStudyData, isStudyLoaded, subscribeStudy } from "../lib/studyStore";
import { registerPushToken, clearPushToken } from "../lib/notifications";

export function usePushRegistration() {
  const { profile } = useApp();
  const uid = profile?.id;
  useEffect(() => {
    if (!uid) return;
    let last: boolean | null = null;
    const check = () => {
      if (!isStudyLoaded()) return;
      const on = getStudyData().prefs.notif.push;
      if (on === last) return;
      last = on;
      if (on) registerPushToken(uid); else clearPushToken(uid);
    };
    const unsub = subscribeStudy(check);
    loadStudy().then(check);
    return unsub;
  }, [uid]);
}

const handled = new Set<string>();
export function usePushTapNavigation() {
  const navigation = useNavigation<any>();
  useEffect(() => {
    const open = (r: NotificationResponse | null) => {
      if (!r || handled.has(r.notification.request.identifier)) return;
      const d: any = r.notification.request.content.data;
      if (d?.type === "announcement" && d.courseId) navigation.navigate("Course", { courseId: d.courseId });
      else if (d?.type === "reply" && d.groupId) navigation.navigate("Group", { groupId: d.groupId });
      else if (["announcement", "direct_message", "group_message", "friend_request", "friend_request_accepted", "admin_request", "admin_reply"].includes(d?.type)) navigation.navigate("Notifications");
      else return;
      handled.add(r.notification.request.identifier);
    };
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    Notifications.getLastNotificationResponseAsync().then(open).catch(() => {});
    return () => sub.remove();
  }, [navigation]);
}
