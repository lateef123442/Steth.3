import { useCallback, useEffect, useState } from "react";
import { useApp } from "../context/AppContext";
import {
  fetchFriends,
  fetchConversations,
  subscribeFriendships,
  subscribeUnreadMessages,
} from "../lib/socialApi";

export interface SocialNotificationCounts {
  requestCount: number;
  unreadMessageCount: number;
  total: number;
}

const EMPTY: SocialNotificationCounts = { requestCount: 0, unreadMessageCount: 0, total: 0 };

/** Counts incoming friend requests and unread private messages, refreshed live from Supabase. */
export default function useSocialNotifications(): SocialNotificationCounts {
  const { profile } = useApp();
  const [counts, setCounts] = useState<SocialNotificationCounts>(EMPTY);

  const refresh = useCallback(async () => {
    if (!profile?.id) { setCounts(EMPTY); return; }
    try {
      const [friends, conversations] = await Promise.all([fetchFriends(), fetchConversations()]);
      const requestCount = friends.incoming.length;
      const unreadMessageCount = conversations.reduce((sum, conversation) => sum + Number(conversation.unread || 0), 0);
      setCounts({ requestCount, unreadMessageCount, total: requestCount + unreadMessageCount });
    } catch {
      // Keep the last known badge while the network is temporarily unavailable.
    }
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) { setCounts(EMPTY); return; }
    refresh();
    const stopFriendships = subscribeFriendships(profile.id, refresh, refresh);
    const stopMessages = subscribeUnreadMessages(profile.id, refresh);
    return () => { stopFriendships(); stopMessages(); };
  }, [profile?.id, refresh]);

  return counts;
}
