import { useCallback, useEffect, useState } from "react";
import { AppState, DeviceEventEmitter } from "react-native";
import { useApp } from "../context/AppContext";
import { fetchMyUnreadGroupMessageCounts, subscribeGroupMessageChanges } from "../lib/groupApi";

/** Live unread message counts keyed by study-group id. */
export default function useGroupUnreadCounts() {
  const { profile } = useApp();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const refresh = useCallback(async () => {
    if (!profile?.id) { setCounts({}); return; }
    try {
      const rows = await fetchMyUnreadGroupMessageCounts();
      setCounts(Object.fromEntries(rows.map((row) => [row.group_id, Number(row.unread_count) || 0])));
    } catch { /* retain last known counts while offline */ }
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) { setCounts({}); return; }
    void refresh();
    const stopMessages = subscribeGroupMessageChanges(refresh);
    const readListener = DeviceEventEmitter.addListener("steth:group-messages-read", refresh);
    const app = AppState.addEventListener("change", (state) => { if (state === "active") void refresh(); });
    return () => { stopMessages(); readListener.remove(); app.remove(); };
  }, [profile?.id, refresh]);

  return counts;
}
