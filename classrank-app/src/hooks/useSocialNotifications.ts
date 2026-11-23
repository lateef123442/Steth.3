import { useCallback, useEffect, useState } from "react";
import { DeviceEventEmitter } from "react-native";
import { useApp } from "../context/AppContext";
import { fetchFriends, fetchConversations, subscribeFriendships, subscribeUnreadMessages } from "../lib/socialApi";
import { fetchMyGroupWelcomeNotifications, subscribeGroupWelcomeNotifications } from "../lib/groupWelcome";
import { fetchMyUnreadGroupMessageCount } from "../lib/groupApi";
import { fetchMyUnreadFeedPostCount, subscribeFeedUnreadChanges } from "../lib/feedApi";

export interface SocialNotificationCounts {
  requestCount: number;
  unreadMessageCount: number;
  groupWelcomeCount: number;
  unreadGroupMessageCount: number;
  feedUnreadCount: number;
  total: number;
}
const EMPTY: SocialNotificationCounts = { requestCount: 0, unreadMessageCount: 0, groupWelcomeCount: 0, unreadGroupMessageCount: 0, feedUnreadCount: 0, total: 0 };

export default function useSocialNotifications(): SocialNotificationCounts {
  const { profile } = useApp();
  const [counts, setCounts] = useState<SocialNotificationCounts>(EMPTY);
  const refresh = useCallback(async () => {
    if (!profile?.id) { setCounts(EMPTY); return; }
    try {
      const [friends, conversations] = await Promise.all([fetchFriends(), fetchConversations()]);
      const [welcomes, unreadGroupMessageCount, feedUnreadCount] = await Promise.all([
        fetchMyGroupWelcomeNotifications().catch(() => []),
        fetchMyUnreadGroupMessageCount().catch(() => 0),
        fetchMyUnreadFeedPostCount().catch(() => 0),
      ]);
      const requestCount = friends.incoming.length;
      const unreadMessageCount = conversations.reduce((sum, conversation) => sum + Number(conversation.unread || 0), 0);
      const groupWelcomeCount = welcomes.length;
      setCounts({ requestCount, unreadMessageCount, groupWelcomeCount, unreadGroupMessageCount, feedUnreadCount, total: requestCount + unreadMessageCount + groupWelcomeCount + unreadGroupMessageCount });
    } catch { /* keep last known badge while offline */ }
  }, [profile?.id]);
  useEffect(() => {
    if (!profile?.id) { setCounts(EMPTY); return; }
    refresh();
    const stopFriendships = subscribeFriendships(profile.id, refresh, refresh);
    const stopMessages = subscribeUnreadMessages(profile.id, refresh);
    const stopWelcomes = subscribeGroupWelcomeNotifications(profile.id, refresh);
    const stopFeed = subscribeFeedUnreadChanges(refresh);
    const feedReadListener = DeviceEventEmitter.addListener("steth:feed-read", refresh);
    return () => { stopFriendships(); stopMessages(); stopWelcomes(); stopFeed(); feedReadListener.remove(); };
  }, [profile?.id, refresh]);
  return counts;
}
