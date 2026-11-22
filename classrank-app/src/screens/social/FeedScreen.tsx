import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, FlatList, TextInput, RefreshControl, Switch, ActivityIndicator, Alert, Image, Share, ScrollView, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radii, spacing, type, shadow } from "../../theme/tokens";
import { useApp } from "../../context/AppContext";
import { fetchFeed, createPost, toggleLike, deletePost, fetchMyLikedPostIds, pickFeedImage, feedImageUrl, fetchPostComments, createPostComment, subscribeFeedChanges, FeedScope } from "../../lib/feedApi";
import { FeedComment, FeedPost } from "../../types";
import PressableScale from "../../components/animated/PressableScale";
import StaggerIn from "../../components/animated/StaggerIn";
import AnimatedNumber from "../../components/animated/AnimatedNumber";
import Avatar from "../../components/Avatar";
import { track, AnalyticsEvents } from "../../lib/analytics";
import EmojiIcon from "../../components/EmojiIcon";

const PAGE_SIZE = 25;
function timeAgo(iso: string): string {
  const diffMs = Math.max(0, Date.now() - new Date(iso).getTime());
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days < 7 ? `${days}d ago` : new Date(iso).toLocaleDateString();
}

function ActivityPanel({ posts, compact, onOpenPost }: { posts: FeedPost[]; compact?: boolean; onOpenPost: (id: string) => void }) {
  const recent = posts.slice(0, 4);
  const trending = [...posts].sort((a, b) => (b.like_count + (b.comment_count ?? 0) * 2) - (a.like_count + (a.comment_count ?? 0) * 2)).slice(0, 3);
  return (
    <View style={[styles.activityPanel, compact && styles.activityPanelCompact]}>
      <View style={styles.activityHeading}>
        <Text style={styles.activityTitle}>Campus pulse</Text>
        <Text style={styles.activitySubtitle}>What people are sharing</Text>
      </View>
      <Text style={styles.activitySectionTitle}>Latest activity</Text>
      {recent.length ? (compact ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.activityHorizontal}>
          {recent.map((post) => (
            <PressableScale key={post.id} style={styles.activityCardCompact} onPress={() => onOpenPost(post.id)} haptic="light">
              <View style={styles.activityPerson}><Avatar name={post.author_name} path={post.author_avatar_path} size={28} /><Text style={styles.activityName} numberOfLines={1}>{post.author_name}</Text></View>
              <Text style={styles.activityAction}>shared a post · {timeAgo(post.created_at)}</Text>
              <Text style={styles.activitySnippet} numberOfLines={2}>{post.content?.trim() || "Shared a photo"}</Text>
            </PressableScale>
          ))}
        </ScrollView>
      ) : recent.map((post) => (
        <PressableScale key={post.id} style={styles.activityItem} onPress={() => onOpenPost(post.id)} haptic="light">
          <Avatar name={post.author_name} path={post.author_avatar_path} size={34} />
          <View style={{ flex: 1 }}>
            <Text style={styles.activityCopy}><Text style={styles.activityName}>{post.author_name}</Text> shared a post</Text>
            <Text style={styles.activitySnippet} numberOfLines={2}>{post.content?.trim() || "Shared a photo"}</Text>
            <Text style={styles.activityTime}>{timeAgo(post.created_at)}</Text>
          </View>
        </PressableScale>
      ))) : <Text style={styles.activityEmpty}>New posts from your community will appear here.</Text>}
      <Text style={[styles.activitySectionTitle, { marginTop: spacing.lg }]}>Trending conversations</Text>
      {trending.length ? (compact ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.activityHorizontal}>
          {trending.map((post) => (
            <PressableScale key={`trend-${post.id}`} style={styles.trendCardCompact} onPress={() => onOpenPost(post.id)} haptic="light">
              <Text style={styles.trendLabel}>POPULAR</Text>
              <Text style={styles.activitySnippet} numberOfLines={2}>{post.content?.trim() || "Photo post"}</Text>
              <Text style={styles.activityTime}>{post.like_count} likes · {post.comment_count ?? 0} comments</Text>
            </PressableScale>
          ))}
        </ScrollView>
      ) : trending.map((post) => (
        <PressableScale key={`trend-${post.id}`} style={styles.trendItem} onPress={() => onOpenPost(post.id)} haptic="light">
          <Text style={styles.trendLabel}>POPULAR</Text>
          <Text style={styles.activitySnippet} numberOfLines={2}>{post.content?.trim() || "Photo post"}</Text>
          <Text style={styles.activityTime}>{post.like_count} likes · {post.comment_count ?? 0} comments</Text>
        </PressableScale>
      ))) : <Text style={styles.activityEmpty}>Popular conversations will appear as people engage.</Text>}
    </View>
  );
}

export default function FeedScreen({ navigation }: any) {
  const { profile } = useApp();
  const { width } = useWindowDimensions();
  const wide = width >= 1050;
  const listRef = useRef<FlatList<FeedPost>>(null);
  const [scope, setScope] = useState<FeedScope>("for_you");
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [openCommentsPostId, setOpenCommentsPostId] = useState<string | null>(null);
  const [commentsByPost, setCommentsByPost] = useState<Record<string, FeedComment[]>>({});
  const [commentsLoadingFor, setCommentsLoadingFor] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentSending, setCommentSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [composerText, setComposerText] = useState("");
  const [composerPublic, setComposerPublic] = useState(false);
  const [composerImage, setComposerImage] = useState<string | null>(null);
  const [pickingImage, setPickingImage] = useState(false);
  const [posting, setPosting] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (!profile?.department_id) return;
    if (refresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const result = await fetchFeed(scope, profile.department_id, PAGE_SIZE, 0);
      setPosts(result);
      setHasMore(result.length === PAGE_SIZE);
      setLikedIds(await fetchMyLikedPostIds(result.map((p) => p.id)));
    } catch (err: any) {
      setError(err?.message ?? "Couldn't load the feed.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [profile?.department_id, scope]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => subscribeFeedChanges(() => { void load(true); }), [load]);

  const loadMore = useCallback(async () => {
    if (!profile?.department_id || loadingMore || !hasMore || loading || refreshing) return;
    setLoadingMore(true);
    try {
      const next = await fetchFeed(scope, profile.department_id, PAGE_SIZE, posts.length);
      setPosts((current) => {
        const seen = new Set(current.map((post) => post.id));
        return [...current, ...next.filter((post) => !seen.has(post.id))];
      });
      setHasMore(next.length === PAGE_SIZE);
      const nextLiked = await fetchMyLikedPostIds(next.map((post) => post.id));
      setLikedIds((current) => new Set([...current, ...nextLiked]));
    } catch (err: any) {
      setError(err?.message ?? "Couldn't load more posts.");
    } finally { setLoadingMore(false); }
  }, [profile?.department_id, scope, posts.length, loadingMore, hasMore, loading, refreshing]);

  if (!profile) return null;

  const openProfile = (userId: string) => {
    if (userId === profile.id) navigation.navigate("Profile");
    else navigation.navigate("PublicProfile", { userId });
  };
  const openPost = (postId: string) => {
    const index = posts.findIndex((post) => post.id === postId);
    if (index >= 0) listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.2 });
  };

  const handlePost = async () => {
    if (composerText.trim().length === 0 && !composerImage) return;
    setPosting(true);
    try {
      await createPost(composerText.trim(), composerPublic, composerImage);
      track(AnalyticsEvents.POST_CREATED, { is_public: composerPublic });
      setComposerText(""); setComposerImage(null); setComposerPublic(false);
      await load(true);
    } catch (err: any) {
      Alert.alert("Couldn't post", err?.message ?? "Something went wrong.");
    } finally { setPosting(false); }
  };

  const handleLike = async (post: FeedPost) => {
    const wasLiked = likedIds.has(post.id);
    setLikedIds((prev) => { const next = new Set(prev); wasLiked ? next.delete(post.id) : next.add(post.id); return next; });
    setPosts((prev) => prev.map((p) => p.id === post.id ? { ...p, like_count: Math.max(0, p.like_count + (wasLiked ? -1 : 1)) } : p));
    try {
      const result = await toggleLike(post.id);
      setPosts((prev) => prev.map((p) => p.id === post.id ? { ...p, like_count: result.like_count } : p));
    } catch {
      setLikedIds((prev) => { const next = new Set(prev); wasLiked ? next.add(post.id) : next.delete(post.id); return next; });
      setPosts((prev) => prev.map((p) => p.id === post.id ? { ...p, like_count: Math.max(0, p.like_count + (wasLiked ? 1 : -1)) } : p));
    }
  };

  const handleToggleComments = async (postId: string) => {
    if (openCommentsPostId === postId) { setOpenCommentsPostId(null); setCommentDraft(""); return; }
    setOpenCommentsPostId(postId); setCommentDraft("");
    if (commentsByPost[postId]) return;
    setCommentsLoadingFor(postId);
    try {
      const comments = await fetchPostComments(postId);
      setCommentsByPost((prev) => ({ ...prev, [postId]: comments }));
    }
    catch (err: any) { Alert.alert("Couldn't load comments", err?.message ?? "Please try again."); }
    finally { setCommentsLoadingFor(null); }
  };

  const handleSendComment = async (post: FeedPost) => {
    const content = commentDraft.trim();
    if (!content || commentSending) return;
    setCommentSending(true);
    try {
      const comment = await createPostComment(post.id, content);
      setCommentsByPost((prev) => ({ ...prev, [post.id]: [...(prev[post.id] ?? []), comment] }));
      setPosts((prev) => prev.map((p) => p.id === post.id ? { ...p, comment_count: (p.comment_count ?? 0) + 1 } : p));
      setCommentDraft("");
    } catch (err: any) { Alert.alert("Couldn't add comment", err?.message ?? "Please try again."); }
    finally { setCommentSending(false); }
  };

  const handleDelete = (post: FeedPost) => Alert.alert("Delete this post?", "This can't be undone.", [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: async () => {
      try { await deletePost(post.id); setPosts((prev) => prev.filter((p) => p.id !== post.id)); }
      catch (err: any) { Alert.alert("Couldn't delete", err?.message ?? "Something went wrong."); }
    } },
  ]);

  const composer = (
    <View style={styles.composer}>
      <View style={styles.composerTop}>
        <Avatar name={profile.name} path={profile.avatar_path} size={42} />
        <View style={{ flex: 1 }}>
          <Text style={styles.composerName}>{profile.name}</Text>
          <Text style={styles.composerHint}>Share something with your campus</Text>
        </View>
      </View>
      <TextInput style={styles.composerInput} placeholder="What's happening on campus?" placeholderTextColor={colors.textFaint} value={composerText} onChangeText={setComposerText} multiline maxLength={1000} />
      {composerImage ? <View style={styles.imagePreviewWrap}>
        <Image source={{ uri: composerImage }} style={styles.imagePreview} />
        <PressableScale style={styles.removeImageButton} onPress={() => setComposerImage(null)} haptic="light"><Text style={styles.removeImageText}>Remove photo ×</Text></PressableScale>
      </View> : null}
      <View style={styles.composerActions}>
        <PressableScale style={styles.addImageButton} disabled={pickingImage || posting} onPress={async () => {
          setPickingImage(true);
          try { const uri = await pickFeedImage(); if (uri) setComposerImage(uri); }
          catch (err: any) { Alert.alert("Couldn't add photo", err?.message ?? "Please try again."); }
          finally { setPickingImage(false); }
        }} haptic="light">
          {pickingImage ? <ActivityIndicator size="small" color={colors.teal} /> : <Text style={styles.addImageText}>＋ Photo</Text>}
        </PressableScale>
        <Text style={styles.photoHint}>Text or photo · up to 5 MB</Text>
      </View>
      <View style={styles.composerFooter}>
        <View style={styles.publicToggleRow}><Switch value={composerPublic} onValueChange={setComposerPublic} trackColor={{ true: colors.teal, false: colors.border }} /><Text style={styles.publicToggleLabel}>Share with campus</Text></View>
        <PressableScale style={[styles.postButton, composerText.trim().length === 0 && !composerImage && styles.postButtonDisabled]} onPress={handlePost} disabled={(composerText.trim().length === 0 && !composerImage) || posting || pickingImage} haptic="medium">
          {posting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.postButtonText}>Post</Text>}
        </PressableScale>
      </View>
    </View>
  );

  const scopeTabs: { key: FeedScope; label: string }[] = [
    { key: "for_you", label: "For you" },
    { key: "department", label: profile.department ?? "Department" },
    { key: "campus", label: "Campus" },
    { key: "trending", label: "Trending" },
  ];

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={{ flex: 1 }}><Text style={styles.title}>Feed</Text><Text style={styles.subtitle}>Your campus, your people, what's happening now.</Text></View>
          <PressableScale style={styles.discoverButton} onPress={() => navigation.navigate("Friends", { initialTab: "Find people" })} haptic="light"><Text style={styles.discoverText}>Find people</Text></PressableScale>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.segmentRow}>
          {scopeTabs.map((tab) => <PressableScale key={tab.key} style={[styles.segment, scope === tab.key && styles.segmentActive]} onPress={() => setScope(tab.key)} haptic="selection"><Text style={[styles.segmentText, scope === tab.key && styles.segmentTextActive]}>{tab.label}</Text></PressableScale>)}
        </ScrollView>
      </View>
      <View style={wide ? styles.wideBody : styles.body}>
        <FlatList
          ref={listRef}
          style={styles.feedList}
          data={posts}
          keyExtractor={(post) => post.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.teal} />}
          ListHeaderComponent={<View>{composer}{!wide && <ActivityPanel posts={posts} compact onOpenPost={openPost} />}</View>}
          ListEmptyComponent={!loading ? <View style={styles.centered}>{error ? <><Text style={styles.errorText}>{error}</Text><PressableScale style={styles.retryButton} onPress={() => load()}><Text style={styles.retryButtonText}>Try Again</Text></PressableScale></> : <><Text style={styles.emptyTitle}>Your feed starts here</Text><Text style={styles.emptyText}>Share a thought, ask a question, or post a photo. New posts from your department and campus will appear here.</Text></>}</View> : null}
          ListFooterComponent={loading || loadingMore ? <ActivityIndicator color={colors.teal} style={{ padding: spacing.lg }} /> : hasMore && posts.length > 0 ? <Text style={styles.listFooterHint}>Scroll for more posts</Text> : null}
          renderItem={({ item, index }) => {
            const isLiked = likedIds.has(item.id);
            const isMine = item.author_id === profile.id;
            return <StaggerIn index={index % 8}>
              <View style={styles.postCard}>
                <View style={styles.postHeader}>
                  <PressableScale onPress={() => openProfile(item.author_id)} haptic="light"><Avatar name={item.author_name} path={item.author_avatar_path} size={44} /></PressableScale>
                  <View style={styles.postAuthorBlock}>
                    <View style={styles.authorLine}>
                      <PressableScale onPress={() => openProfile(item.author_id)} haptic="light"><Text style={styles.authorName}>{item.author_name}</Text></PressableScale>
                      {item.author_role !== "student" && <View style={styles.roleBadge}><Text style={styles.roleBadgeText}>{item.author_role}</Text></View>}
                    </View>
                    <Text style={styles.postMeta}>{item.author_username ? `@${item.author_username} · ` : ""}{scope === "campus" ? `${item.department} · ` : ""}{timeAgo(item.created_at)}</Text>
                  </View>
                  {(isMine || profile.role === "admin") && <PressableScale onPress={() => handleDelete(item)} haptic="none" style={styles.moreButton}><Text style={styles.moreText}>•••</Text></PressableScale>}
                </View>
                {!!item.content?.trim() && <Text style={styles.postContent}>{item.content}</Text>}
                {!!feedImageUrl(item.image_path) && <Image source={{ uri: feedImageUrl(item.image_path)! }} style={styles.postImage} resizeMode="cover" />}
                <View style={styles.postFooter}>
                  <View style={styles.postActions}>
                    <PressableScale style={styles.actionButton} onPress={() => handleLike(item)} haptic="light"><EmojiIcon emoji={isLiked ? "♥" : "♡"} style={[styles.likeIcon, isLiked && styles.likeIconActive]} /><AnimatedNumber value={item.like_count} style={styles.actionCount} duration={250} /></PressableScale>
                    <PressableScale style={styles.actionButton} onPress={() => handleToggleComments(item.id)} haptic="light"><Text style={styles.actionEmoji}>💬</Text><Text style={styles.actionCount}>{item.comment_count ?? 0}</Text><Text style={styles.actionLabel}>Comments</Text></PressableScale>
                    <PressableScale style={styles.actionButton} onPress={() => Share.share({ message: `${item.author_name} on Steth\n\n${item.content || "Shared a photo"}` })} haptic="light"><Text style={styles.actionEmoji}>↗</Text><Text style={styles.actionLabel}>Share</Text></PressableScale>
                  </View>
                </View>
                {openCommentsPostId === item.id && <View style={styles.commentsPanel}>
                  {commentsLoadingFor === item.id ? <ActivityIndicator color={colors.teal} /> : (commentsByPost[item.id] ?? []).map((comment) => <View key={comment.id} style={styles.commentItem}>
                    <PressableScale onPress={() => openProfile(comment.author_id)} haptic="light"><Avatar name={comment.author_name} path={comment.author_avatar_path} size={30} /></PressableScale>
                    <View style={{ flex: 1 }}><View style={styles.commentMeta}><PressableScale onPress={() => openProfile(comment.author_id)} haptic="light"><Text style={styles.commentAuthor}>{comment.author_name}</Text></PressableScale><Text style={styles.commentTime}>{timeAgo(comment.created_at)}</Text></View><Text style={styles.commentText}>{comment.content}</Text></View>
                  </View>)}
                  {!commentsLoadingFor && (commentsByPost[item.id] ?? []).length === 0 && <Text style={styles.noComments}>No comments yet. Start the conversation.</Text>}
                  <View style={styles.commentComposer}><TextInput value={commentDraft} onChangeText={setCommentDraft} placeholder="Write a comment..." placeholderTextColor={colors.textFaint} style={styles.commentInput} multiline maxLength={1000} /><PressableScale style={[styles.commentSend, (!commentDraft.trim() || commentSending) && { opacity: 0.5 }]} onPress={() => handleSendComment(item)} disabled={!commentDraft.trim() || commentSending} haptic="light">{commentSending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.commentSendText}>Send</Text>}</PressableScale></View>
                </View>}
              </View>
            </StaggerIn>;
          }}
          onEndReached={() => { void loadMore(); }}
          onEndReachedThreshold={0.55}
          onScrollToIndexFailed={({ index }) => { listRef.current?.scrollToOffset({ offset: Math.max(0, index * 260), animated: true }); }}
          showsVerticalScrollIndicator={false}
        />
        {wide && <ScrollView style={styles.sidebarScroll} contentContainerStyle={styles.sidebarContent} showsVerticalScrollIndicator={false}><ActivityPanel posts={posts} onOpenPost={openPost} /></ScrollView>}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.sm },
  headerTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  title: { ...type.h1, color: colors.text },
  subtitle: { ...type.caption, color: colors.textMuted, marginTop: 2 },
  discoverButton: { borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  discoverText: { ...type.caption, color: colors.tealDeep, fontWeight: "800" },
  segmentRow: { flexDirection: "row", gap: spacing.sm, paddingTop: spacing.md, paddingRight: spacing.xl },
  segment: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radii.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  segmentActive: { backgroundColor: colors.teal, borderColor: colors.teal },
  segmentText: { ...type.caption, color: colors.textMuted, fontWeight: "700" },
  segmentTextActive: { color: "#fff" },
  body: { flex: 1 },
  wideBody: { flex: 1, flexDirection: "row", gap: spacing.lg, paddingHorizontal: spacing.lg },
  feedList: { flex: 1 },
  list: { padding: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.xxxl * 2 },
  sidebarScroll: { width: 310, flexGrow: 0 },
  sidebarContent: { paddingTop: spacing.sm, paddingBottom: spacing.xxxl },
  composer: { backgroundColor: colors.card, borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border, ...shadow.card },
  composerTop: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.md },
  composerName: { ...type.bodyMedium, color: colors.text },
  composerHint: { ...type.caption, color: colors.textFaint, marginTop: 2 },
  composerInput: { ...type.body, color: colors.text, minHeight: 58, textAlignVertical: "top", paddingVertical: spacing.sm },
  composerActions: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.sm },
  addImageButton: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  addImageText: { ...type.caption, color: colors.teal, fontWeight: "800" },
  photoHint: { ...type.caption, color: colors.textFaint },
  imagePreviewWrap: { marginTop: spacing.md },
  imagePreview: { width: "100%", height: 190, borderRadius: radii.md, backgroundColor: colors.border },
  removeImageButton: { alignSelf: "flex-start", marginTop: spacing.xs, paddingVertical: 4, paddingHorizontal: spacing.sm },
  removeImageText: { ...type.caption, color: colors.danger },
  composerFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.md },
  publicToggleRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, flex: 1 },
  publicToggleLabel: { ...type.caption, color: colors.textMuted },
  postButton: { backgroundColor: colors.teal, borderRadius: radii.pill, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm, minWidth: 76, alignItems: "center" },
  postButtonDisabled: { opacity: 0.4 },
  postButtonText: { color: "#fff", fontFamily: type.bodyBold.fontFamily, fontSize: 14 },
  postCard: { backgroundColor: colors.card, borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border, ...shadow.card },
  postHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.md },
  postAuthorBlock: { flex: 1 },
  authorLine: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.xs },
  authorName: { ...type.bodyMedium, color: colors.text },
  roleBadge: { backgroundColor: colors.violetTint, borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  roleBadgeText: { fontSize: 10, color: colors.violet, fontWeight: "800", textTransform: "capitalize" },
  postMeta: { ...type.caption, color: colors.textFaint, marginTop: 2 },
  moreButton: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  moreText: { color: colors.textMuted, fontWeight: "800", letterSpacing: 2 },
  postContent: { ...type.body, color: colors.text, marginBottom: spacing.md, lineHeight: 22 },
  postImage: { width: "100%", height: 260, borderRadius: radii.md, marginBottom: spacing.md, backgroundColor: colors.border },
  postFooter: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  postActions: { flexDirection: "row", alignItems: "center", gap: spacing.xxl },
  actionButton: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: spacing.xs },
  actionEmoji: { fontSize: 16, color: colors.textMuted },
  actionCount: { ...type.caption, color: colors.textMuted },
  actionLabel: { ...type.caption, color: colors.textMuted },
  likeIcon: { fontSize: 19, color: colors.textFaint },
  likeIconActive: { color: colors.danger },
  commentsPanel: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md, marginTop: spacing.md },
  commentItem: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingVertical: spacing.sm },
  commentMeta: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  commentAuthor: { ...type.caption, color: colors.text, fontWeight: "800" },
  commentTime: { ...type.caption, color: colors.textFaint, fontSize: 10 },
  commentText: { ...type.body, color: colors.text, marginTop: 3 },
  noComments: { ...type.caption, color: colors.textFaint, paddingVertical: spacing.sm },
  commentComposer: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, marginTop: spacing.sm },
  commentInput: { flex: 1, minHeight: 42, maxHeight: 100, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text, ...type.caption },
  commentSend: { minWidth: 58, height: 42, borderRadius: radii.md, backgroundColor: colors.teal, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md },
  commentSendText: { color: "#fff", fontWeight: "800", ...type.caption },
  centered: { alignItems: "center", padding: spacing.xxxl },
  errorText: { ...type.caption, color: colors.textMuted, textAlign: "center", marginBottom: spacing.md },
  retryButton: { backgroundColor: colors.teal, borderRadius: radii.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.xl },
  retryButtonText: { color: "#fff", ...type.h3, fontSize: 14 },
  emptyTitle: { ...type.h3, color: colors.text, textAlign: "center" },
  emptyText: { ...type.caption, color: colors.textMuted, textAlign: "center", marginTop: spacing.sm, lineHeight: 19 },
  listFooterHint: { ...type.caption, color: colors.textFaint, textAlign: "center", padding: spacing.lg },
  activityPanel: { backgroundColor: colors.card, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  activityPanelCompact: { marginBottom: spacing.lg },
  activityHeading: { marginBottom: spacing.md },
  activityTitle: { ...type.h3, color: colors.text },
  activitySubtitle: { ...type.caption, color: colors.textMuted, marginTop: 2 },
  activitySectionTitle: { ...type.caption, color: colors.text, fontWeight: "800", marginBottom: spacing.sm },
  activityItem: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  activityPerson: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.xs },
  activityCopy: { ...type.caption, color: colors.textMuted },
  activityName: { ...type.caption, color: colors.text, fontWeight: "800" },
  activityAction: { ...type.caption, color: colors.textFaint, fontSize: 11 },
  activitySnippet: { ...type.caption, color: colors.text, marginTop: 4, lineHeight: 17 },
  activityTime: { ...type.caption, color: colors.textFaint, fontSize: 10, marginTop: spacing.xs },
  activityEmpty: { ...type.caption, color: colors.textFaint, lineHeight: 18, paddingVertical: spacing.sm },
  activityHorizontal: { gap: spacing.sm, paddingRight: spacing.sm },
  activityCardCompact: { width: 220, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.border },
  trendCardCompact: { width: 190, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.border },
  trendItem: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  trendLabel: { ...type.caption, color: colors.tealDeep, fontSize: 10, fontWeight: "900", letterSpacing: 0.8 },
});
