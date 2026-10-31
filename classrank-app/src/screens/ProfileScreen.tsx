import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Alert, TextInput, ActivityIndicator, Modal, Share } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Avatar from "../components/Avatar";
import { changeAvatar, removeAvatar } from "../lib/socialApi";
import { LinearGradient } from "expo-linear-gradient";
import { colors, radii, spacing, type, shadow, getActiveScheme, ThemeMode } from "../theme/tokens";
import { loadThemeMode, saveThemeMode, restartApp } from "../theme/themeMode";
import { useApp } from "../context/AppContext";
import PressableScale from "../components/animated/PressableScale";
import StaggerIn from "../components/animated/StaggerIn";
import BadgeCelebrationModal from "../components/BadgeCelebrationModal";
import ProPaymentModal from "../components/ProPaymentModal";
import { hasActivePro, daysLeft } from "../lib/proApi";
import { earnedBadges } from "../data/badges";
import { useNewBadgeCelebration } from "../hooks/useNewBadgeCelebration";
import { fetchReferralStats, redeemReferralCode, peekPendingReferral, clearPendingReferral } from "../lib/referralApi";
import { inviteMessage } from "../lib/appLinks";
import { runNotificationCheck } from "../lib/notifications";
import { ReferralStats } from "../types";
import { track, AnalyticsEvents } from "../lib/analytics";
import { useNavigation } from "@react-navigation/native";
import { useStudy, achievements, xpInfo, studyStreak } from "../lib/studyStore";

export default function ProfileScreen() {
  const { profile, signOut, deleteAccount, authError, refreshProfileAfterPurchase, paywallEnabled } = useApp();
  const [signingOut, setSigningOut] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const navigation = useNavigation<any>();
  const { data: study } = useStudy();
  const xp = xpInfo(study), ach = achievements(study);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const { celebrating, dismiss } = useNewBadgeCelebration(profile);
  const [referralStats, setReferralStats] = useState<ReferralStats | null>(null);
  const [themeMode, setThemeModeState] = useState<ThemeMode | null>(null);
  const [inviteInput, setInviteInput] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [checkingNotifs, setCheckingNotifs] = useState(false);

  // A code that arrived through an invite link waits here until it is used.
  useEffect(() => { peekPendingReferral().then((c) => { if (c) setInviteInput((cur) => cur || c); }); }, []);

  const handleRedeem = async () => {
    const code = inviteInput.trim();
    if (!code || redeeming) return;
    setRedeeming(true);
    try {
      const r = await redeemReferralCode(code);
      if (!r.ok) { Alert.alert("Couldn't use that code", r.error ?? "Please try again."); return; }
      await clearPendingReferral();
      setInviteInput("");
      await refreshProfileAfterPurchase();
      fetchReferralStats().then(setReferralStats).catch(() => {});
      Alert.alert("7 days of Pro unlocked 🎉", "Your friend got 7 days too. Each account can use an invite code once, so this one is done.");
    } catch (e: any) {
      Alert.alert("Couldn't use that code", e?.message ?? "Please try again.");
    } finally { setRedeeming(false); }
  };

  const handleCheckNotifications = async () => {
    if (!profile || checkingNotifs) return;
    setCheckingNotifs(true);
    try { const r = await runNotificationCheck(profile.id); Alert.alert(r.title, r.message); }
    catch (e: any) { Alert.alert("Check failed", e?.message ?? "Please try again."); }
    finally { setCheckingNotifs(false); }
  };

  useEffect(() => { loadThemeMode().then(setThemeModeState); }, []);

  // Screens build their styles at start-up, so a new appearance is applied by restarting the app.
  const chooseTheme = (mode: ThemeMode) => {
    if (mode === themeMode) return;
    const label = mode === "system" ? "match your phone" : mode;
    Alert.alert("Change appearance?", `Steth will restart to switch to ${label} mode.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Restart now",
        onPress: async () => {
          try { await saveThemeMode(mode); setThemeModeState(mode); }
          catch { Alert.alert("Couldn't save", "Please try again."); return; }
          const ok = await restartApp();
          if (!ok) Alert.alert("Almost done", "Your choice is saved. Close Steth completely and open it again to see it.");
        },
      },
    ]);
  };

  useEffect(() => {
    if (profile?.role === "student") {
      fetchReferralStats()
        .then(setReferralStats)
        .catch(() => setReferralStats(null));
    }
  }, [profile?.id]);

  if (!profile) return null;

  const badges = earnedBadges(profile);

  const roleLabel = profile.role === "admin" ? "Admin" : profile.role === "teacher" ? "Teacher" : "Student";

  const handleSignOut = () => {
    Alert.alert("Log out?", "You can log back in anytime.", [
      { text: "Cancel", style: "cancel" },
      { text: "Log Out", style: "destructive", onPress: async () => { setSigningOut(true); try { await signOut(); } finally { setSigningOut(false); } } },
    ]);
  };

  const handleShareReferral = () => {
    if (!referralStats) return;
    track(AnalyticsEvents.REFERRAL_SHARED);
    Share.share({
      message: inviteMessage(referralStats.referral_code, paywallEnabled === true),
    });
  };

  const closeDeleteModal = () => {
    setShowDeleteModal(false);
    setConfirmText("");
  };

  const handleConfirmDelete = async () => {
    setDeleting(true);
    const success = await deleteAccount();
    setDeleting(false);
    if (success) closeDeleteModal();
  };

  const editPicture = () => {
    const pick = async () => {
      setAvatarBusy(true);
      try { if (await changeAvatar(profile.id, profile.avatar_path)) await refreshProfileAfterPurchase(); }
      catch (e: any) { Alert.alert("Couldn't update your picture", e?.message ?? "Try again."); } finally { setAvatarBusy(false); }
    };
    if (!profile.avatar_path) return void pick();
    Alert.alert("Profile picture", undefined, [
      { text: "Choose a new picture", onPress: pick },
      { text: "Remove picture", style: "destructive", onPress: async () => { try { await removeAvatar(profile.avatar_path); await refreshProfileAfterPurchase(); } catch (e: any) { Alert.alert("Couldn't remove it", e?.message ?? "Try again."); } } },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <PressableScale onPress={editPicture} disabled={avatarBusy} accessibilityLabel="Change profile picture">
          <View style={[styles.avatarRing, profile.is_pro && styles.avatarRingPro]}>
            {profile.avatar_path ? <Avatar name={profile.name} path={profile.avatar_path} size={80} /> : (
              <LinearGradient colors={[colors.teal, colors.tealDeep]} style={styles.avatar}>
                <Text style={styles.avatarText}>{profile.name.charAt(0).toUpperCase()}</Text>
              </LinearGradient>
            )}
          </View>
          <Text style={{ color: colors.tealDeep, textAlign: "center", marginTop: 6, fontWeight: "600" }}>{avatarBusy ? "Saving…" : "Edit picture"}</Text>
        </PressableScale>
        <View style={styles.nameRow}>
          <Text style={styles.name}>{profile.name}</Text>
          {profile.is_pro && <Text style={styles.proCrown}>👑</Text>}
        </View>
        {profile.role !== "student" && (
          <View style={styles.roleBadge}>
            <Text style={styles.roleBadgeText}>{roleLabel}</Text>
          </View>
        )}
        <Text style={styles.meta}>{profile.university}</Text>
        <Text style={styles.meta}>
          {profile.department ?? "All departments"}
          {profile.year ? ` · Year ${profile.year}` : ""}
        </Text>

        <PressableScale style={[styles.signOutTop, signingOut && { opacity: 0.6 }]} onPress={handleSignOut} disabled={signingOut} haptic="medium" accessibilityRole="button" accessibilityLabel="Log out">
          {signingOut ? <ActivityIndicator color={colors.danger} size="small" /> : <Text style={styles.signOutButtonText}>Log Out</Text>}
        </PressableScale>

        {profile.role === "student" && (
          <View style={styles.statsRow}>
            <View style={styles.statBlock}>
              <Text style={styles.statValue}>{profile.total_points}</Text>
              <Text style={styles.statLabel}>Points</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBlock}>
              <Text style={[styles.statValue, { color: colors.ember }]}>{profile.current_streak}</Text>
              <Text style={styles.statLabel}>Day Streak</Text>
            </View>
          </View>
        )}

        {profile.role === "student" && (
          <>
            <Text style={styles.sectionTitle}>Study profile</Text>
            <View style={{ alignSelf: "stretch" }}>
              <Text style={{ ...type.body, color: colors.textMuted }}>Level {xp.level} · {xp.xp} XP · {xp.toNext} to next level · {studyStreak(study)}-day study streak</Text>
              {ach.map((a) => (
                <Text key={a.id} style={{ ...type.body, color: a.earned ? colors.text : colors.textFaint, marginTop: 4 }}>
                  {a.earned ? "🏅" : "▫️"} {a.title}{a.earned ? "" : ` — ${a.have}/${a.need}`}
                </Text>
              ))}
              <PressableScale style={{ marginTop: spacing.md, backgroundColor: colors.tealTint, borderRadius: radii.md, padding: spacing.lg }} onPress={() => navigation.navigate("StudySetup")}>
                <Text style={{ ...type.h3, color: colors.tealDeep }}>Goals, study times & notifications →</Text>
              </PressableScale>
              <PressableScale style={{ marginTop: spacing.sm, backgroundColor: colors.violetTint, borderRadius: radii.md, padding: spacing.lg }} onPress={() => navigation.navigate("Community")}>
                <Text style={{ ...type.h3, color: colors.text }}>👥 Community: courses, groups & feed →</Text>
              </PressableScale>
            </View>
            <Text style={styles.sectionTitle}>Badges</Text>
            {badges.length === 0 ? (
              <Text style={styles.emptyText}>Complete quizzes to start earning badges.</Text>
            ) : (
              <View style={styles.badgeWrap}>
                {badges.map((b, i) => (
                  <StaggerIn key={b.id} index={i}>
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>
                        {b.emoji} {b.label}
                      </Text>
                    </View>
                  </StaggerIn>
                ))}
              </View>
            )}
          </>
        )}

        {profile.role === "student" && paywallEnabled === true &&
          (hasActivePro(profile) ? (
            <View style={styles.proStatusCard}>
              <Text style={styles.proStatusTitle}>👑 You're Pro</Text>
              <Text style={styles.proStatusSubtitle}>{daysLeft(profile.pro_expires_at)} day{daysLeft(profile.pro_expires_at) === 1 ? "" : "s"} left · Streak Shield is active.</Text>
              <PressableScale style={styles.manageButton} onPress={() => setShowUpgradeModal(true)} haptic="light">
                <Text style={styles.manageButtonText}>Renew / add time</Text>
              </PressableScale>
            </View>
          ) : (
            <PressableScale
              style={styles.goProCard}
              onPress={() => {
                track(AnalyticsEvents.UPGRADE_MODAL_VIEWED);
                setShowUpgradeModal(true);
              }}
              haptic="medium"
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.goProTitle}>Go Pro 👑</Text>
                <Text style={styles.goProSubtitle}>Get Streak Shield and a Pro badge on the leaderboard.</Text>
              </View>
              <Text style={styles.goProArrow}>→</Text>
            </PressableScale>
          ))}

        {profile.role === "student" && referralStats && (
          <View style={styles.inviteCard}>
            <Text style={styles.inviteTitle}>Invite Friends</Text>
            <Text style={styles.inviteSubtitle}>
              {paywallEnabled === true
                ? "When a friend uses your code, you both get 7 days of Pro free. You also earn 100 points once they've studied on 3 different days."
                : "Share your code with friends. You earn 100 points once they've studied on 3 different days."}
            </Text>
            <View style={styles.codeRow}>
              <Text style={styles.codeText}>{referralStats.referral_code}</Text>
              <PressableScale style={styles.shareButton} onPress={handleShareReferral} haptic="medium">
                <Text style={styles.shareButtonText}>Share</Text>
              </PressableScale>
            </View>
            <View style={styles.inviteStatsRow}>
              <Text style={styles.inviteStatText}>
                {referralStats.total_referred} invited · {referralStats.total_rewarded} vested
              </Text>
            </View>
          </View>
        )}

        {profile.role === "student" && paywallEnabled === true && referralStats && referralStats.has_redeemed === false && (
          <View style={styles.appearanceCard}>
            <Text style={styles.appearanceTitle}>🎁 Got an invite code?</Text>
            <Text style={styles.appearanceHint}>Enter a friend's code and you both get 7 days of Pro free. You can only do this once.</Text>
            <View style={[styles.appearanceRow, { alignItems: "center" }]}>
              <TextInput
                style={styles.inviteInput}
                value={inviteInput}
                onChangeText={setInviteInput}
                placeholder="Invite code"
                placeholderTextColor={colors.textFaint}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={12}
              />
              <PressableScale style={[styles.inviteApply, (!inviteInput.trim() || redeeming) && { opacity: 0.5 }]} onPress={handleRedeem} haptic="medium">
                <Text style={styles.inviteApplyText}>{redeeming ? "…" : "Apply"}</Text>
              </PressableScale>
            </View>
          </View>
        )}

        <View style={styles.appearanceCard}>
          <Text style={styles.appearanceTitle}>🔔 Notifications</Text>
          <Text style={styles.appearanceHint}>Not getting reminders or class announcements? Run a quick check.</Text>
          <PressableScale style={[styles.inviteApply, { marginTop: spacing.md, alignSelf: "flex-start" }, checkingNotifs && { opacity: 0.5 }]} onPress={handleCheckNotifications} haptic="light">
            <Text style={styles.inviteApplyText}>{checkingNotifs ? "Checking…" : "Check notifications"}</Text>
          </PressableScale>
        </View>

        <View style={styles.appearanceCard}>
          <Text style={styles.appearanceTitle}>🌗 Appearance</Text>
          <Text style={styles.appearanceHint}>Currently {getActiveScheme()} mode. Pick how Steth looks.</Text>
          <View style={styles.appearanceRow}>
            {([["light", "☀️ Light"], ["dark", "🌙 Dark"], ["system", "📱 Phone"]] as [ThemeMode, string][]).map(([m, label]) => (
              <PressableScale
                key={m}
                style={[styles.appearanceOption, themeMode === m && styles.appearanceOptionOn]}
                onPress={() => chooseTheme(m)}
                haptic="light"
                accessibilityRole="button"
                accessibilityLabel={`${label} mode`}
                accessibilityState={{ selected: themeMode === m }}
              >
                <Text style={[styles.appearanceOptionText, themeMode === m && { color: "#fff" }]}>{label}</Text>
              </PressableScale>
            ))}
          </View>
        </View>
        <PressableScale style={{ marginBottom: spacing.md, backgroundColor: colors.emberTint, borderRadius: radii.md, padding: spacing.lg }} onPress={() => navigation.navigate("Feedback")} accessibilityRole="button" accessibilityLabel="Help and feedback">
          <Text style={{ color: colors.text, fontWeight: "700" }}>💬 Help & feedback</Text>
          <Text style={{ color: colors.textMuted, marginTop: 2 }}>Report a problem, make a complaint or suggest an idea to the admins.</Text>
        </PressableScale>
        <PressableScale
          style={styles.deleteAccountButton}
          onPress={() => setShowDeleteModal(true)}
          haptic="none"
          accessibilityRole="button"
          accessibilityLabel="Delete account"
        >
          <Text style={styles.deleteAccountButtonText}>Delete Account</Text>
        </PressableScale>
      </ScrollView>

      <Modal visible={showDeleteModal} transparent animationType="fade" onRequestClose={closeDeleteModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Delete your account?</Text>
            <Text style={styles.modalBody}>
              This permanently deletes your profile, points, streak, and quiz history. This can't be undone.
            </Text>
            <Text style={styles.modalBody}>
              Type <Text style={styles.modalBold}>DELETE</Text> to confirm.
            </Text>
            <TextInput
              style={styles.modalInput}
              value={confirmText}
              onChangeText={setConfirmText}
              autoCapitalize="characters"
              placeholder="DELETE"
              placeholderTextColor={colors.textFaint}
              accessibilityLabel="Type DELETE to confirm account deletion"
            />
            {authError && <Text style={styles.modalError}>{authError}</Text>}
            <View style={styles.modalButtonRow}>
              <PressableScale style={styles.modalCancelButton} onPress={closeDeleteModal} haptic="light">
                <Text style={styles.modalCancelText}>Cancel</Text>
              </PressableScale>
              <PressableScale
                style={[styles.modalDeleteButton, confirmText !== "DELETE" && styles.modalDeleteButtonDisabled]}
                onPress={handleConfirmDelete}
                disabled={confirmText !== "DELETE" || deleting}
                haptic="medium"
              >
                {deleting ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalDeleteText}>Delete Forever</Text>}
              </PressableScale>
            </View>
          </View>
        </View>
      </Modal>

      <BadgeCelebrationModal badge={celebrating} onDismiss={dismiss} />
      <ProPaymentModal visible={showUpgradeModal} onClose={() => setShowUpgradeModal(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  container: { padding: spacing.xxl, paddingBottom: spacing.xxxl * 2, alignItems: "center" },
  avatarRing: { padding: 3, borderRadius: 48, borderWidth: 2, borderColor: "transparent", marginTop: spacing.md },
  avatarRingPro: { borderColor: colors.gold },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.floating,
  },
  avatarText: { color: "#fff", fontSize: 32, fontFamily: type.hero.fontFamily },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.lg },
  name: { ...type.h1, fontSize: 20, color: colors.text },
  proCrown: { fontSize: 18 },
  roleBadge: { backgroundColor: colors.violet, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, marginTop: spacing.sm },
  roleBadgeText: { color: "#fff", fontSize: 13, fontFamily: type.bodySemibold.fontFamily, textTransform: "uppercase" },
  meta: { ...type.caption, color: colors.textMuted, marginTop: spacing.sm },
  statsRow: { flexDirection: "row", alignItems: "center", marginTop: spacing.xxl, backgroundColor: colors.card, borderRadius: radii.lg, paddingVertical: spacing.lg, width: "100%", justifyContent: "center", ...shadow.card },
  statBlock: { alignItems: "center", flex: 1 },
  statDivider: { width: 1, height: 36, backgroundColor: colors.border },
  statValue: { ...type.h1, fontSize: 26, color: colors.teal },
  statLabel: { ...type.caption, color: colors.textMuted, marginTop: 4 },
  sectionTitle: { ...type.h3, color: colors.text, alignSelf: "flex-start", marginTop: spacing.xxl, marginBottom: spacing.md },
  emptyText: { ...type.caption, color: colors.textMuted, alignSelf: "flex-start" },
  badgeWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, alignSelf: "flex-start" },
  badge: { backgroundColor: colors.violetTint, borderRadius: radii.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  badgeText: { ...type.caption, fontFamily: type.bodySemibold.fontFamily, color: colors.violet },
  goProCard: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.ink,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginTop: spacing.xxl,
    ...shadow.floating,
  },
  goProTitle: { ...type.h3, color: colors.textOnDark },
  goProSubtitle: { ...type.caption, color: colors.textOnDarkMuted, marginTop: 2 },
  goProArrow: { color: colors.gold, fontSize: 20, marginLeft: spacing.md },
  proStatusCard: {
    width: "100%",
    backgroundColor: colors.emberTint,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginTop: spacing.xxl,
    alignItems: "center",
  },
  proStatusTitle: { ...type.h3, color: colors.text },
  proStatusSubtitle: { ...type.caption, color: colors.textMuted, marginTop: 4, textAlign: "center", marginBottom: spacing.md },
  manageButton: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  manageButtonText: { ...type.caption, color: colors.tealDeep, fontFamily: type.bodySemibold.fontFamily },
  inviteCard: {
    width: "100%",
    backgroundColor: colors.violetTint,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginTop: spacing.xxl,
  },
  inviteTitle: { ...type.h3, color: colors.text, marginBottom: 4 },
  inviteSubtitle: { ...type.caption, color: colors.textMuted, marginBottom: spacing.md, lineHeight: 17 },
  codeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.card, borderRadius: radii.md, padding: spacing.md },
  codeText: { ...type.h2, letterSpacing: 2, color: colors.violet },
  shareButton: { backgroundColor: colors.violet, borderRadius: radii.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  shareButtonText: { color: "#fff", fontFamily: type.bodyBold.fontFamily, fontSize: 13 },
  inviteStatsRow: { marginTop: spacing.sm, alignItems: "center" },
  inviteStatText: { ...type.caption, color: colors.textMuted },
  signOutButton: { marginTop: spacing.xl, alignSelf: "stretch", alignItems: "center", justifyContent: "center", minHeight: 48, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.danger, backgroundColor: colors.card },
  signOutTop: { marginTop: spacing.md, minHeight: 40, minWidth: 140, paddingHorizontal: spacing.xl, alignItems: "center", justifyContent: "center", borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.danger, backgroundColor: colors.card },
  signOutButtonText: { color: colors.danger, ...type.body, fontFamily: type.bodyBold.fontFamily },
  deleteAccountButton: { marginTop: 4, paddingVertical: spacing.md, paddingHorizontal: spacing.xl },
  deleteAccountButtonText: { color: colors.textFaint, fontSize: 13, textDecorationLine: "underline" },
  appearanceCard: { backgroundColor: colors.card, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.md },
  appearanceTitle: { color: colors.text, fontWeight: "700" },
  appearanceHint: { color: colors.textMuted, marginTop: 2 },
  appearanceRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  appearanceOption: { flex: 1, paddingVertical: spacing.md, borderRadius: radii.md, alignItems: "center", backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.border },
  appearanceOptionOn: { backgroundColor: colors.teal, borderColor: colors.teal },
  appearanceOptionText: { color: colors.text, fontWeight: "600", fontSize: 13 },
  inviteInput: { flex: 1, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text, letterSpacing: 1 },
  inviteApply: { backgroundColor: colors.teal, borderRadius: radii.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  inviteApplyText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(16,22,44,0.6)", justifyContent: "center", padding: spacing.xxl },
  modalCard: { backgroundColor: colors.card, borderRadius: radii.xl, padding: spacing.xxl, ...shadow.floating },
  modalTitle: { ...type.h2, color: colors.text, marginBottom: spacing.md },
  modalBody: { ...type.body, color: colors.text, marginBottom: spacing.sm },
  modalBold: { fontFamily: type.bodyBold.fontFamily, color: colors.danger },
  modalInput: {
    backgroundColor: colors.paper,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 15,
    fontFamily: type.body.fontFamily,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    marginTop: spacing.sm,
    marginBottom: 4,
  },
  modalError: { color: colors.danger, ...type.caption, marginTop: spacing.sm },
  modalButtonRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.xl },
  modalCancelButton: { flex: 1, paddingVertical: spacing.lg, borderRadius: radii.md, alignItems: "center", borderWidth: 1, borderColor: colors.border },
  modalCancelText: { color: colors.textMuted, fontFamily: type.bodyBold.fontFamily },
  modalDeleteButton: { flex: 1, backgroundColor: colors.danger, paddingVertical: spacing.lg, borderRadius: radii.md, alignItems: "center" },
  modalDeleteButtonDisabled: { opacity: 0.4 },
  modalDeleteText: { color: "#fff", fontFamily: type.bodyBold.fontFamily },
});
