import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { useApp } from "../context/AppContext";
import { fetchMyUnreadNotificationCount, subscribeMyNotifications } from "../lib/notificationApi";

export default function useUnreadNotificationCount(): number {
  const { profile } = useApp();
  const [count, setCount] = useState(0);
  const refresh = useCallback(async () => {
    if (!profile?.id) { setCount(0); return; }
    try { setCount(await fetchMyUnreadNotificationCount()); } catch { /* keep last known count while offline */ }
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) { setCount(0); return; }
    void refresh();
    const stop = subscribeMyNotifications(profile.id, refresh);
    const app = AppState.addEventListener("change", (state) => { if (state === "active") void refresh(); });
    return () => { stop(); app.remove(); };
  }, [profile?.id, refresh]);
  return count;
}
