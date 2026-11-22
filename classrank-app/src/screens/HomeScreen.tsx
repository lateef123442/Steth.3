import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useIsFocused } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { colors, radii, spacing, type, shadow } from "../theme/tokens";
import { useApp } from "../context/AppContext";
import PulseRing from "../components/animated/PulseRing";
import Reveal from "../components/animated/Reveal";
import AnimatedNumber from "../components/animated/AnimatedNumber";
import StreakFlame from "../components/animated/StreakFlame";
import PressableScale from "../components/animated/PressableScale";
import { fetchRecentAnnouncements, Announcement } from "../lib/courseApi";
import { useStudy, recommend, todaySessions, subjectName, focusMinutes, weakestTopic, fmtTime12 } from "../lib/studyStore";
import ArenaBackground from "../components/ArenaBackground";
import StartHereCard from "../components/StartHereCard";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { MainTabParamList } from "../navigation/RootNavigator";

import EmojiIcon from "../components/EmojiIcon";
type Props = BottomTabScreenProps<MainTabParamList, "Home">;

const MILESTONE_STEP = 500;

export default function HomeScreen({ navigation }: Props) {
  const { profile, todaysQuestions, hasCompletedTodaysQuiz, departmentLeaderboard } = useApp();
  const isFocused = useIsFocused();
  const { data: study } = useStudy();
  const plan = todaySessions(study);
  const rec = recommend(study);
  const thisWeek = focusMinutes(study, 6, 0);
  const lastWeek = focusMinutes(study, 13, 7);
  // Teacher announcements from my courses. Silent on failure (offline, or the course tables aren't deployed yet).
  const [news, setNews] = useState<Announcement[]>([]);
  useEffect(() => {
    const load = () => fetchRecentAnnouncements().then(setNews).catch(() => setNews([]));
    load();
    return (navigation as any).addListener?.("focus", load);
  }, [navigation]);
  const activePlan = plan.filter((x) => x.status !== "skipped");
  const plannedMin = activePlan.reduce((a, x) => a + x.minutes, 0);
  const doneMin = activePlan.filter((x) => x.status === "done").reduce((a, x) => a + x.minutes, 0);
  const planProgress = plannedMin ? doneMin / plannedMin : 0;
  const streak = profile?.login_streak ?? 0;
  const weak = weakestTopic(study);
  const nextTimed = plan.filter((x) => x.status === "planned" && x.time).sort((a, b) => a.time!.localeCompare(b.time!))[0];
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  // Tabs and stack screens are both reachable by name from here; params carry e.g. the subject to focus on.
  const go = (t: string, params?: any) => (navigation as any).navigate(t, params);

  const departmentRank = useMemo(() => {
    if (!profile) return null;
    const idx = departmentLeaderboard.findIndex((e) => e.id === profile.id);
    return idx === -1 ? null : idx + 1;
  }, [departmentLeaderboard, profile]);

  const { ringProgress, pointsToNext } = useMemo(() => {
    if (!profile) return { ringProgress: 0, pointsToNext: MILESTONE_STEP };
    const withinStep = profile.total_points % MILESTONE_STEP;
    return { ringProgress: withinStep / MILESTONE_STEP, pointsToNext: MILESTONE_STEP - withinStep };
  }, [profile]);

  if (!profile) return null;

  return (
    <SafeAreaView style={styles.safe}>
      {isFocused && <StatusBar style="light" />}
      <ScrollView contentContainerStyle={styles.container}>
        <StartHereCard onGo={go} />

        <ArenaBackground>
          <View style={styles.heroInner}>
            <Text style={styles.greeting}>{hello}, {profile.name.split(" ")[0]}</Text>
            <Text style={styles.heroSubtitle}>{plannedMin > 0 ? `You have ${plannedMin} minutes planned today${nextTimed ? ` · next at ${fmtTime12(nextTimed.time!)}` : ""}.` : "Nothing planned yet. Let's fix that."}</Text>

            <View style={styles.ringWrap}>
              <PulseRing size={160} strokeWidth={12} progress={plannedMin ? planProgress : ringProgress} color={colors.teal}>
                <AnimatedNumber value={plannedMin ? doneMin : profile.total_points} style={styles.ringNumber} />
                <Text style={styles.ringLabel}>{plannedMin ? `OF ${plannedMin} MIN` : "POINTS"}</Text>
              </PulseRing>
            </View>

            <Text style={styles.milestoneCaption}>{plannedMin ? (doneMin >= plannedMin ? "Today's plan is done" : `${plannedMin - doneMin} min left in today's plan`) : `${pointsToNext} pts to your next milestone`}</Text>

            <View style={styles.chipRow}>
              <View style={styles.chip}>
                <StreakFlame streak={streak} size={18} />
                <AnimatedNumber value={streak} style={styles.chipValueText} />
                <Text style={styles.chipLabel}>day streak</Text>
              </View>

              <View style={[styles.chip, styles.chipViolet]}>
                <Text style={styles.chipRank}>{departmentRank ? `#${departmentRank}` : "N/A"}</Text>
                <Text style={styles.chipLabel}>in department</Text>
              </View>
            </View>
          </View>
        </ArenaBackground>

        {news.length > 0 && (
          <Reveal>
          <PressableScale style={[styles.planCard, { backgroundColor: colors.emberTint }]} onPress={() => go("Course", { courseId: news[0].course_id })} accessibilityRole="button">
            <Text style={styles.quizCardTitle}>{news[0].course_code}: {news[0].title}</Text>
            {!!news[0].body && <Text style={styles.quizCardSubtitle} numberOfLines={2}>{news[0].body}</Text>}
            {news.length > 1 && <Text style={styles.quizCardSubtitle}>+{news.length - 1} more recent announcement{news.length > 2 ? "s" : ""}</Text>}
          </PressableScale>
          </Reveal>
        )}
        <View style={styles.planCard}>
          <Text style={styles.quizCardTitle}>Today's plan</Text>
          {plan.length === 0 ? (
            <Text style={styles.quizCardSubtitle}>Nothing planned yet.</Text>
          ) : (
            plan.map((s) => (
              <Text key={s.id} style={styles.quizCardSubtitle}>
                {s.status === "done" ? "Done · " : s.status === "skipped" ? "Skipped · " : ""}{s.time ? `${fmtTime12(s.time)} · ` : ""}{subjectName(study, s.subjectId)}, {s.minutes} min
              </Text>
            ))
          )}
          <Text style={[styles.quizCardSubtitle, { marginTop: spacing.sm }]}>
            ⏱ {thisWeek} min focused this week{lastWeek > 0 ? ` (${thisWeek >= lastWeek ? "+" : "-"}${Math.round((Math.abs(thisWeek - lastWeek) / lastWeek) * 100)}% vs last week)` : ""}
          </Text>
          {weak && <Text style={[styles.quizCardSubtitle, { marginTop: 4 }]}>Weakest topic: {weak.name} ({weak.accuracy}%)</Text>}
          <Text style={styles.recText}>{rec.text}</Text>
          {rec.steps && <Text style={styles.quizCardSubtitle}>{rec.steps.join("  →  ")}</Text>}
          <PressableScale style={styles.recBtn} onPress={() => go(rec.target, rec.params)} haptic="medium">
            <Text style={styles.recBtnText}>{rec.cta} →</Text>
          </PressableScale>
        </View>

        <Text style={styles.quickActionsTitle}>What would you like to do?</Text>
        <View style={styles.tiles}>
          {([["🗓", "Study plan", "Planner"], ["🎯", "Practice", "Practice"], ["📄", "PDF to CBT", "PDFPractice"], ["📈", "My progress", "Progress"], ["🏆", "My rank", "Leaderboard"], ["👥", "Community", "Community"]] as const).map(([icon, label, target]) => (
            <PressableScale key={target} style={styles.tile} onPress={() => go(target)} accessibilityRole="button">
              <EmojiIcon emoji={icon} style={{ fontSize: 22 }} />
              <Text style={styles.tileText}>{label}</Text>
            </PressableScale>
          ))}
        </View>

        <PressableScale
          style={[styles.quizCard, hasCompletedTodaysQuiz && styles.quizCardDone]}
          onPress={() => navigation.navigate("Quiz")}
          disabled={hasCompletedTodaysQuiz || todaysQuestions.length === 0}
          haptic="medium"
          accessibilityRole="button"
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.quizCardTitle}>
              {hasCompletedTodaysQuiz ? "Department quiz: done" : "Your daily quiz is ready"}
            </Text>
            <Text style={styles.quizCardSubtitle}>
              {hasCompletedTodaysQuiz
                ? "Come back tomorrow to keep your streak alive."
                : todaysQuestions.length > 0
                ? `${todaysQuestions.length} questions · ${profile.department}`
                : "No quiz is ready yet. Please check back later."}
            </Text>
          </View>
          {!hasCompletedTodaysQuiz && todaysQuestions.length > 0 && (
            <View style={styles.quizCardArrow}>
              <Text style={styles.quizCardArrowText}>→</Text>
            </View>
          )}
        </PressableScale>

        <PressableScale style={styles.studyCard} onPress={() => go("Study", plan.find((x) => x.status === "planned") ? { subject: subjectName(study, plan.find((x) => x.status === "planned")!.subjectId) } : undefined)} haptic="medium" accessibilityRole="button">
          <View style={{ flex: 1 }}>
            <Text style={styles.quizCardTitle}>⏱ Study with a timer</Text>
            <Text style={styles.quizCardSubtitle}>Set a timer and focus on one course without distractions.</Text>
          </View>
        </PressableScale>

        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>How your rank works</Text>
          <Text style={styles.infoText}>
            Your points are compared first within {profile.department}, so you're always ranked fairly against
            students in your own field, then rolled up into your faculty and campus-wide leaderboards.
          </Text>
        </View>
      </ScrollView>
      <PressableScale
        style={styles.aiFab}
        onPress={() => go("Companion")}
        accessibilityRole="button"
        accessibilityLabel="Open AI study helper"
        haptic="medium"
      >
        <Ionicons name="sparkles" size={24} color="#FFFFFF" />
      </PressableScale>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  aiFab: { position: "absolute", right: spacing.lg, bottom: spacing.xs, zIndex: 100, width: 58, height: 58, borderRadius: 29, backgroundColor: colors.tealDeep, alignItems: "center", justifyContent: "center", elevation: 14, shadowColor: "#000", shadowOpacity: 0.24, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, borderWidth: 2, borderColor: "#FFFFFF" },
  container: { padding: spacing.xl, paddingBottom: spacing.xxxl * 2 },
  heroInner: { alignItems: "center", paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg },
  greeting: { ...type.h1, color: colors.textOnDark, alignSelf: "flex-start" },
  heroSubtitle: { ...type.body, color: colors.textOnDarkMuted, alignSelf: "flex-start", marginTop: 2, marginBottom: spacing.xl },
  ringWrap: { marginVertical: spacing.sm },
  ringNumber: { ...type.hero, fontSize: 34, lineHeight: 38, color: colors.textOnDark, textAlign: "center" },
  ringLabel: { ...type.label, color: colors.textOnDarkMuted, textAlign: "center", marginTop: 2 },
  milestoneCaption: { ...type.caption, color: colors.textOnDarkMuted, marginTop: spacing.lg },
  chipRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.xl },
  chip: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  chipViolet: { backgroundColor: "rgba(124,108,245,0.18)" },
  chipValueText: { ...type.h3, color: colors.textOnDark },
  chipRank: { ...type.h3, color: colors.violet },
  chipLabel: { ...type.caption, color: colors.textOnDarkMuted },
  quizCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    padding: spacing.xl,
    marginTop: spacing.xl,
    ...shadow.card,
  },
  quizCardDone: { opacity: 0.7 },
  quizCardTitle: { ...type.h3, color: colors.text },
  quizCardSubtitle: { ...type.caption, color: colors.textMuted, marginTop: 4 },
  quizCardArrow: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.tealTint,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: spacing.md,
  },
  quizCardArrowText: { color: colors.tealDeep, fontSize: 18, fontFamily: type.h3.fontFamily },
  planCard: { backgroundColor: colors.card, borderRadius: radii.lg, padding: spacing.xl, marginTop: spacing.lg, ...shadow.card },
  recText: { ...type.bodyMedium, color: colors.text, marginTop: spacing.md },
  recBtn: { backgroundColor: colors.teal, borderRadius: radii.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.md },
  recBtnText: { ...type.h3, color: "#fff" },
  quickActionsTitle: { ...type.h3, color: colors.text, marginTop: spacing.xl },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  tile: { width: "31%", flexGrow: 1, backgroundColor: colors.card, borderRadius: radii.md, paddingVertical: spacing.lg, alignItems: "center", ...shadow.card },
  tileText: { ...type.caption, color: colors.text, marginTop: 4, textAlign: "center" },
  studyCard: { flexDirection: "row", alignItems: "center", backgroundColor: colors.tealTint, borderRadius: radii.lg, padding: spacing.xl, marginTop: spacing.lg },
  infoCard: { backgroundColor: colors.violetTint, borderRadius: radii.md, padding: spacing.lg, marginTop: spacing.lg },
  infoTitle: { ...type.h3, color: colors.text, marginBottom: 6 },
  infoText: { ...type.body, color: colors.textMuted, lineHeight: 20 },
});
