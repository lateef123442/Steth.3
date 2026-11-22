import { useCallback, useEffect, useState } from "react";
import { useApp } from "../context/AppContext";
import { fetchFriends, fetchConversations, subscribeFriendships, subscribeUnreadMessages } from "../lib/socialApi";
import { fetchMyGroupWelcomeNotifications, subscribeGroupWelcomeNotifications } from "../lib/groupWelcome";

export interface SocialNotificationCounts {
  requestCount: number;
  unreadMessageCount: number;
  groupWelcomeCount: number;
  total: number;
}
const EMPTY: SocialNotificationCounts = { requestCount: 0, unreadMessageCount: 0, groupWelcomeCount: 0, total: 0 };

export default function useSocialNotifications(): SocialNotificationCounts {
  const { profile } = useApp();
  const [counts, setCounts] = useState<SocialNotificationCounts>(EMPTY);
  const refresh = useCallback(async () => {
    if (!profile?.id) { setCounts(EMPTY); return; }
    try {
      const [friends, conversations, welcomes] = await Promise.all([fetchFriends(), fetchConversations(), fetchMyGroupWelcomeNotifications()]);
      const requestCount = friends.incoming.length;
      const unreadMessageCount = conversations.reduce((sum, conversation) => sum + Number(conversation.unread || 0), 0);
      const groupWelcomeCount = welcomes.length;
      setCounts({ requestCount, unreadMessageCount, groupWelcomeCount, total: requestCount + unreadMessageCount + groupWelcomeCount });
    } catch { /* keep last known badge while offline */ }
  }, [profile?.id]);
  useEffect(() => {
    if (!profile?.id) { setCounts(EMPTY); return; }
    refresh();
    const stopFriendships = subscribeFriendships(profile.id, refresh, refresh);
    const stopMessages = subscribeUnreadMessages(profile.id, refresh);
    const stopWelcomes = subscribeGroupWelcomeNotifications(profile.id, refresh);
    return () => { stopFriendships(); stopMessages(); stopWelcomes(); };
  }, [profile?.id, refresh]);
  return counts;
}
