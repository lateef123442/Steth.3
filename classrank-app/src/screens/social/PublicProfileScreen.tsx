import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radii, spacing, type, shadow } from "../../theme/tokens";
import { useApp } from "../../context/AppContext";
import { fetchPublicProfile, fetchProfilePosts, feedImageUrl } from "../../lib/feedApi";
import { respondFriendRequest, sendFriendRequest } from "../../lib/socialApi";
import { FeedPost, PublicProfile } from "../../types";
import Avatar from "../../components/Avatar";
import PressableScale from "../../components/animated/PressableScale";

function joinedLabel(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export default function PublicProfileScreen({ route, navigation }: any) {
  const { profile: me } = useApp();
  const userId = route.params?.userId as string | undefined;
  const [person, setPerson] = useState<PublicProfile | null>(null);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [relation, setRelation] = useState<PublicProfile["relation"]>("none");

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [publicProfile, profilePosts] = await Promise.all([fetchPublicProfile(userId), fetchProfilePosts(userId)]);
      setPerson(publicProfile);
      setPosts(profilePosts);
      setRelation(publicProfile?.relation ?? "none");
    } catch (error: any) {
      Alert.alert("Couldn't open profile", error?.message ?? "Please try again.");
    } finally { setLoading(false); }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  const connect = async () => {
    if (!person || busy) return;
    setBusy(true);
    try {
      if (relation === "received") {
        await respondFriendRequest(person.id, true);
        setRelation("friend");
      } else {
        const next = await sendFriendRequest(person.id);
        setRelation(next);
      }
    } catch (error: any) {
      Alert.alert("Couldn't update connection", error?.message ?? "Please try again.");
    } finally { setBusy(false); }
  };

  if (loading) return <SafeAreaView style={styles.safe}><View style={styles.loading}><ActivityIndicator color={colors.teal} size="large" /><Text style={styles.loadingText}>Loading profile…</Text></View></SafeAreaView>;
  if (!person) return <SafeAreaView style={styles.safe}><View style={styles.loading}><Text style={styles.emptyTitle}>This profile isn't available</Text><Text style={styles.emptyText}>It may have been removed, or this person may have blocked this account.</Text><PressableScale style={styles.backButton} onPress={() => navigation.goBack()}><Text style={styles.backText}>Go back</Text></PressableScale></View></SafeAreaView>;

  const canConnect = person.role === "student" && me?.role === "student" && person.id !== me.id;
  const memberSince = joinedLabel(person.member_since);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <PressableScale onPress={() => navigation.goBack()} style={styles.backButton}><Text style={styles.backText}>‹  Back to feed</Text></PressableScale>
        <View style={styles.hero}>
          <Avatar name={person.name} path={person.avatar_path} size={92} />
          <Text style={styles.name}>{person.name}</Text>
          {!!person.username && <Text style={styles.username}>@{person.username}</Text>}
          <View style={styles.rolePill}><Text style={styles.roleText}>{person.role}</Text></View>
          <Text style={styles.bio}>{person.bio?.trim() || "This person hasn't added a bio yet."}</Text>
          {canConnect && <View style={styles.actions}>
            <PressableScale style={[styles.primaryButton, (busy || relation === "sent") && styles.disabled]} onPress={connect} disabled={busy || relation === "sent"} haptic="medium">
              {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.primaryButtonText}>{relation === "friend" ? "Connected" : relation === "sent" ? "Request sent" : relation === "received" ? "Accept request" : "＋ Add friend"}</Text>}
            </PressableScale>
            {relation === "friend" && <PressableScale style={styles.secondaryButton} onPress={() => navigation.navigate("Chat", { userId: person.id, name: person.name, department: person.department, year: person.year, avatar_path: person.avatar_path })} haptic="light"><Text style={styles.secondaryButtonText}>Message</Text></PressableScale>}
          </View>}
          <View style={styles.statsRow}><View style={styles.stat}><Text style={styles.statValue}>{person.post_count}</Text><Text style={styles.statLabel}>Posts</Text></View><View style={styles.statDivider} /><View style={styles.stat}><Text style={styles.statValue}>{memberSince || "—"}</Text><Text style={styles.statLabel}>Member since</Text></View></View>
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.sectionTitle}>About</Text>
          <InfoRow label="University" value={person.university} />
          <InfoRow label="Faculty" value={person.faculty} />
          <InfoRow label="Department" value={person.department} />
          {person.year ? <InfoRow label="Year of study" value={`Year ${person.year}`} /> : null}
        </View>

        <View style={styles.postsHeading}><Text style={styles.sectionTitle}>Posts</Text><Text style={styles.postsCount}>{posts.length} shown</Text></View>
        {posts.length ? posts.map((post) => <ProfilePost key={post.id} post={post} />) : <View style={styles.emptyCard}><Text style={styles.emptyTitle}>No posts to show</Text><Text style={styles.emptyText}>Posts shared with your department or campus will appear here.</Text></View>}
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return <View style={styles.infoRow}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View>;
}

function ProfilePost({ post }: { post: FeedPost }) {
  const image = feedImageUrl(post.image_path);
  return <View style={styles.postCard}>
    <View style={styles.postMetaRow}><Text style={styles.postMeta}>{new Date(post.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</Text>{post.is_public && <Text style={styles.publicLabel}>Campus post</Text>}</View>
    {!!post.content?.trim() && <Text style={styles.postContent}>{post.content}</Text>}
    {!!image && <Image source={{ uri: image }} style={styles.postImage} resizeMode="cover" />}
    <Text style={styles.engagement}>{post.like_count} likes  ·  {post.comment_count ?? 0} comments</Text>
  </View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  container: { padding: spacing.xl, paddingBottom: spacing.xxxl * 2, maxWidth: 820, width: "100%", alignSelf: "center" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xxxl, gap: spacing.md },
  loadingText: { ...type.caption, color: colors.textMuted },
  backButton: { alignSelf: "flex-start", paddingVertical: spacing.md, marginBottom: spacing.sm },
  backText: { color: colors.tealDeep, fontWeight: "800" },
  hero: { alignItems: "center", backgroundColor: colors.card, borderRadius: radii.xl, borderWidth: 1, borderColor: colors.border, padding: spacing.xl, ...shadow.card },
  name: { ...type.h1, color: colors.text, textAlign: "center", marginTop: spacing.md },
  username: { ...type.body, color: colors.tealDeep, fontWeight: "700", marginTop: 2 },
  rolePill: { backgroundColor: colors.violetTint, borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, marginTop: spacing.sm },
  roleText: { ...type.caption, color: colors.violet, fontWeight: "800", textTransform: "capitalize" },
  bio: { ...type.body, color: colors.textMuted, textAlign: "center", lineHeight: 22, marginTop: spacing.lg, maxWidth: 560 },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg, width: "100%", justifyContent: "center" },
  primaryButton: { backgroundColor: colors.teal, borderRadius: radii.pill, paddingVertical: spacing.md, paddingHorizontal: spacing.xl, minWidth: 140, alignItems: "center" },
  primaryButtonText: { color: "#fff", fontWeight: "800" },
  secondaryButton: { backgroundColor: colors.tealTint, borderRadius: radii.pill, paddingVertical: spacing.md, paddingHorizontal: spacing.xl, minWidth: 110, alignItems: "center" },
  secondaryButtonText: { color: colors.tealDeep, fontWeight: "800" },
  disabled: { opacity: 0.55 },
  statsRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xxl, marginTop: spacing.xl, paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, width: "100%" },
  stat: { alignItems: "center", minWidth: 100 },
  statValue: { ...type.h3, color: colors.text },
  statLabel: { ...type.caption, color: colors.textFaint, marginTop: 2 },
  statDivider: { width: 1, height: 34, backgroundColor: colors.border },
  infoCard: { backgroundColor: colors.card, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginTop: spacing.lg },
  sectionTitle: { ...type.h3, color: colors.text },
  infoRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  infoLabel: { ...type.caption, color: colors.textMuted },
  infoValue: { ...type.caption, color: colors.text, fontWeight: "700", textAlign: "right", flex: 1 },
  postsHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.xl, marginBottom: spacing.md },
  postsCount: { ...type.caption, color: colors.textFaint },
  postCard: { backgroundColor: colors.card, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.md, ...shadow.card },
  postMetaRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: spacing.sm },
  postMeta: { ...type.caption, color: colors.textFaint },
  publicLabel: { ...type.caption, color: colors.tealDeep, fontWeight: "700" },
  postContent: { ...type.body, color: colors.text, lineHeight: 22, marginBottom: spacing.md },
  postImage: { width: "100%", height: 250, borderRadius: radii.md, backgroundColor: colors.border },
  engagement: { ...type.caption, color: colors.textMuted, marginTop: spacing.md },
  emptyCard: { backgroundColor: colors.card, borderRadius: radii.lg, padding: spacing.xl, alignItems: "center" },
  emptyTitle: { ...type.h3, color: colors.text, textAlign: "center" },
  emptyText: { ...type.caption, color: colors.textMuted, textAlign: "center", marginTop: spacing.sm, lineHeight: 19 },
});
