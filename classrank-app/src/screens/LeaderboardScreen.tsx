import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, RefreshControl, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radii, spacing, type } from "../theme/tokens";
import { useApp } from "../context/AppContext";
import PressableScale from "../components/animated/PressableScale";
import StaggerIn from "../components/animated/StaggerIn";
import { LeaderboardRowSkeleton } from "../components/animated/Skeleton";
import LeaderboardRow from "../components/LeaderboardRow";
import LeaderboardPodium from "../components/LeaderboardPodium";
import { useNavigation } from "@react-navigation/native";
import { fetchFriends, sendFriendRequest, respondFriendRequest, subscribeFriendships } from "../lib/socialApi";
import type { Friends } from "../lib/socialApi";

type Tier = "Department" | "Faculty" | "Campus";
const TIERS: Tier[] = ["Department", "Faculty", "Campus"];

export default function LeaderboardScreen() {
  const {
    profile,
    departmentLeaderboard,
    facultyLeaderboard,
    campusLeaderboard,
    campusHasMore,
    loadMoreCampusLeaderboard,
    leaderboardLoading,
    leaderboardError,
    refreshLeaderboards,
  } = useApp();
  const [tier, setTier] = useState<Tier>("Department");
  const navigation = useNavigation<any>();
  const [friendships, setFriendships] = useState<Friends>({ friends: [], incoming: [], outgoing: [] });
  const [friendActionBusy, setFriendActionBusy] = useState<string | null>(null);

  const loadFriendships = useCallback(async () => {
    try { setFriendships(await fetchFriends()); }
    catch { /* The leaderboard remains usable if social data is temporarily unavailable. */ }
  }, []);

  useEffect(() => {
    if (!profile || profile.role !== "student") return;
    loadFriendships();
    const stopRealtime = subscribeFriendships(profile.id, loadFriendships, loadFriendships);
    const stopFocus = navigation.addListener("focus", loadFriendships);
    return () => { stopRealtime(); stopFocus(); };
  }, [profile?.id, profile?.role, loadFriendships, navigation]);

  if (!profile) return null;

  const rows =
    tier === "Department" ? departmentLeaderboard : tier === "Faculty" ? facultyLeaderboard : campusLeaderboard;

  const subtitleFor = (entryDept: string, entryFaculty: string) => (tier === "Department" ? entryFaculty : entryDept);

  const runFriendAction = async (userId: string, action: "send" | "accept" | "decline") => {
    if (friendActionBusy) return;
    setFriendActionBusy(userId);
    try {
      if (action === "send") await sendFriendRequest(userId);
      else await respondFriendRequest(userId, action === "accept");
      await loadFriendships();
    } catch (error: any) {
      Alert.alert("Couldn't update friend request", error?.message ?? "Please try again.");
    } finally { setFriendActionBusy(null); }
  };

  const friendButton = (label: string, onPress: () => void, disabled = false, secondary = false) => (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      haptic="light"
      style={[styles.friendAction, secondary && styles.friendActionSecondary, disabled && styles.friendActionDisabled]}
    >
      <Text style={[styles.friendActionText, secondary && styles.friendActionTextSecondary]}>{label}</Text>
    </PressableScale>
  );

  const friendActionFor = (entry: (typeof rows)[number]) => {
    if (entry.id === profile.id || profile.role !== "student") return null;
    if (friendActionBusy === entry.id) return friendButton("Please wait…", () => {}, true);
    if (friendships.friends.some((person) => person.id === entry.id)) {
      return friendButton("Message", () => navigation.navigate("Chat", { userId: entry.id, name: entry.name, department: entry.department, year: null, avatar_path: null }));
    }
    if (friendships.outgoing.some((person) => person.id === entry.id)) return friendButton("Requested", () => {}, true, true);
    if (friendships.incoming.some((person) => person.id === entry.id)) {
      return (
        <View style={styles.friendActionGroup}>
          {friendButton("Accept", () => runFriendAction(entry.id, "accept"))}
          {friendButton("Decline", () => runFriendAction(entry.id, "decline"), false, true)}
        </View>
      );
    }
    return friendButton("＋ Add friend", () => runFriendAction(entry.id, "send"));
  };

  if (leaderboardError && rows.length === 0) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.errorState}>
          <Text style={styles.errorTitle}>Couldn't load the leaderboard</Text>
          <Text style={styles.errorSubtitle}>{leaderboardError}</Text>
          <PressableScale style={styles.retryButton} onPress={refreshLeaderboards} haptic="medium">
            <Text style={styles.retryButtonText}>Try Again</Text>
          </PressableScale>
        </View>
      </SafeAreaView>
    );
  }

  const top3 = rows.slice(0, 3);
  const rest = rows.slice(3);
  const showPodium = top3.length === 3;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Leaderboard</Text>
        <View style={styles.segmentRow}>
          {TIERS.map((t) => (
            <PressableScale
              key={t}
              style={[styles.segment, tier === t && styles.segmentActive]}
              onPress={() => setTier(t)}
              haptic="selection"
              accessibilityRole="tab"
              accessibilityState={{ selected: tier === t }}
            >
              <Text style={[styles.segmentText, tier === t && styles.segmentTextActive]}>{t}</Text>
            </PressableScale>
          ))}
        </View>
        <Text style={styles.scopeLabel}>
          {tier === "Department" && `Department: ${profile.department} · ${profile.university}`}
          {tier === "Faculty" && `Faculty: ${profile.faculty} · ${profile.university}`}
          {tier === "Campus" && `Campus leaderboard for ${profile.university}`}
        </Text>
      </View>

      {leaderboardLoading && rows.length === 0 ? (
        <View style={styles.list}>
          {Array.from({ length: 6 }).map((_, i) => (
            <LeaderboardRowSkeleton key={i} />
          ))}
        </View>
      ) : (
        <FlatList
          data={rest}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          onEndReached={tier === "Campus" && campusHasMore ? loadMoreCampusLeaderboard : undefined}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl refreshing={leaderboardLoading} onRefresh={refreshLeaderboards} tintColor={colors.teal} />
          }
          ListHeaderComponent={
            showPodium ? (
              <LeaderboardPodium top3={top3} currentUserId={profile.id} renderAction={friendActionFor} />
            ) : top3.length > 0 ? (
              <View style={{ marginBottom: spacing.sm }}>
                {top3.map((item, i) => (
                  <LeaderboardRow
                    key={item.id}
                    rank={i + 1}
                    name={item.id === profile.id ? `${item.name} (You)` : item.name}
                    subtitle={subtitleFor(item.department, item.faculty)}
                    points={item.points}
                    isCurrentUser={item.id === profile.id}
                    isPro={item.is_pro}
                    percentile={tier === "Department" ? undefined : item.department_percentile}
                    action={friendActionFor(item)}
                  />
                ))}
              </View>
            ) : null
          }
          renderItem={({ item, index }) => (
            <StaggerIn index={index}>
              <LeaderboardRow
                rank={index + 4}
                name={item.id === profile.id ? `${item.name} (You)` : item.name}
                subtitle={subtitleFor(item.department, item.faculty)}
                points={item.points}
                isCurrentUser={item.id === profile.id}
                isPro={item.is_pro}
                percentile={tier === "Department" ? undefined : item.department_percentile}
                action={friendActionFor(item)}
              />
            </StaggerIn>
          )}
          ListEmptyComponent={
            !leaderboardLoading && rows.length === 0 ? (
              <Text style={styles.emptyText}>No rankings yet. Be the first to take a quiz.</Text>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  title: { ...type.h1, color: colors.text, marginBottom: spacing.md },
  segmentRow: { flexDirection: "row", backgroundColor: colors.card, borderRadius: radii.md, padding: 4 },
  segment: { flex: 1, paddingVertical: spacing.sm, borderRadius: radii.sm, alignItems: "center" },
  segmentActive: { backgroundColor: colors.teal },
  segmentText: { ...type.caption, fontFamily: type.bodySemibold.fontFamily, color: colors.textMuted },
  segmentTextActive: { color: "#fff" },
  scopeLabel: { ...type.caption, color: colors.textMuted, marginTop: spacing.md, marginBottom: 4 },
  list: { padding: spacing.xl, paddingTop: spacing.md },
  emptyText: { textAlign: "center", color: colors.textMuted, marginTop: 40, ...type.caption },
  errorState: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xxxl },
  errorTitle: { ...type.h2, color: colors.text, textAlign: "center" },
  errorSubtitle: { ...type.caption, color: colors.textMuted, textAlign: "center", marginTop: spacing.sm, marginBottom: spacing.xl },
  retryButton: { backgroundColor: colors.teal, borderRadius: radii.md, paddingVertical: spacing.md, paddingHorizontal: spacing.xxl },
  retryButtonText: { color: "#fff", ...type.h3 },
  friendAction: { backgroundColor: colors.teal, borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 5, marginTop: 4 },
  friendActionSecondary: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  friendActionDisabled: { opacity: 0.55 },
  friendActionText: { color: "#fff", fontSize: 11, fontFamily: type.bodySemibold.fontFamily },
  friendActionTextSecondary: { color: colors.textMuted },
  friendActionGroup: { flexDirection: "row", gap: 4, marginTop: 4 },
});
