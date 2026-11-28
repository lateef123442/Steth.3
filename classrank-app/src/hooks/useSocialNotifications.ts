import { useCallback, useEffect, useState } from "react";
import { DeviceEventEmitter } from "react-native";
import { useApp } from "../context/AppContext";
import { fetchFriends, fetchConversations, subscribeFriendships, subscribeUnreadMessages } from "../lib/socialApi";
import { fetchMyGroupWelcomeNotifications, subscribeGroupWelcomeNotifications } from "../lib/groupWelcome";
import { fetchMyUnreadGroupMessageCount, subscribeGroupMessageChanges } from "../lib/groupApi";
import { fetchMyCourses, fetchDailyQuiz } from "../lib/courseApi";
import { fetchMyUnreadFeedPostCount, subscribeFeedUnreadChanges } from "../lib/feedApi";

export interface SocialNotificationCounts {
  requestCount: number;
  unreadMessageCount: number;
  groupWelcomeCount: number;
  unreadGroupMessageCount: number;
  feedUnreadCount: number;
  total: number;
  dailyCourseQuizCount: number;
}
const EMPTY: SocialNotificationCounts = { requestCount: 0, unreadMessageCount: 0, groupWelcomeCount: 0, unreadGroupMessageCount: 0, feedUnreadCount: 0, total: 0, dailyCourseQuizCount: 0 };

export default function useSocialNotifications(): SocialNotificationCounts {
  const { profile } = useApp();
  const [counts, setCounts] = useState<SocialNotificationCounts>(EMPTY);
  const [dailyCourseQuizCount, setDailyCourseQuizCount] = useState(0);
  const refreshDailyCourseQuizCount = useCallback(async () => {
    try {
      const courses = await fetchMyCourses();
      const available = await Promise.all(courses.map(async (course) => {
        try { return (await fetchDailyQuiz(course.id)).available_questions > 0; }
        catch { return false; }
      }));
      setDailyCourseQuizCount(available.filter(Boolean).length);
    } catch { setDailyCourseQuizCount(0); }
  }, []);

  useEffect(() => {
    if (!profile?.id) { setDailyCourseQuizCount(0); return; }
    void refreshDailyCourseQuizCount();
    const quizFocus = DeviceEventEmitter.addListener("steth:quiz-count-refresh", refreshDailyCourseQuizCount);
    return () => quizFocus.remove();
  }, [profile?.id, refreshDailyCourseQuizCount]);

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
      setCounts({ requestCount, unreadMessageCount, groupWelcomeCount, unreadGroupMessageCount, feedUnreadCount, total: requestCount + unreadMessageCount + groupWelcomeCount + unreadGroupMessageCount, dailyCourseQuizCount: 0 });
    } catch { /* keep last known badge while offline */ }
  }, [profile?.id]);
  useEffect(() => {
    if (!profile?.id) { setCounts(EMPTY); return; }
    refresh();
    const stopFriendships = subscribeFriendships(profile.id, refresh, refresh);
    const stopMessages = subscribeUnreadMessages(profile.id, refresh);
    const stopWelcomes = subscribeGroupWelcomeNotifications(profile.id, refresh);
    const stopFeed = subscribeFeedUnreadChanges(refresh);
    const stopGroupMessages = subscribeGroupMessageChanges(refresh);
    const feedReadListener = DeviceEventEmitter.addListener("steth:feed-read", refresh);
    const groupReadListener = DeviceEventEmitter.addListener("steth:group-messages-read", refresh);
    return () => { stopFriendships(); stopMessages(); stopWelcomes(); stopFeed(); stopGroupMessages(); feedReadListener.remove(); groupReadListener.remove(); };
  }, [profile?.id, refresh]);
  return { ...counts, dailyCourseQuizCount };
}
