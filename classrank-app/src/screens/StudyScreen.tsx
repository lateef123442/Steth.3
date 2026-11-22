import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Alert, Linking, BackHandler } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { colors, radii, spacing, type } from "../theme/tokens";
import PressableScale from "../components/animated/PressableScale";
import { setNotificationsMuted } from "../lib/notifications";
import Breathing from "../components/animated/Breathing";
import Reveal from "../components/animated/Reveal";
import { useStudy, logFocus, todaySessions, setSessionStatus, subjectName, focusMinutes, dateStr } from "../lib/studyStore";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { MainTabParamList } from "../navigation/RootNavigator";
import { WRAP } from "../components/responsive";
import { syncMyCoursesToStudy } from "../lib/courseApi";

type Props = BottomTabScreenProps<MainTabParamList, "Study">;

const DURATIONS = [15, 25, 45, 60];
const BREAKS = [5, 10, 15];
const THEMES = {
  light: { name: "Light", bg: "#FFFFFF", text: "#1A1F36", muted: "#6B7280" },
  dark: { name: "Dark", bg: "#0B0F1F", text: "#E5E7EB", muted: "#9CA6C4" },
  sepia: { name: "Sepia", bg: "#F4ECD8", text: "#433422", muted: "#7A6650" },
} as const;
type ThemeKey = keyof typeof THEMES;

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function StudyScreen({ navigation, route }: Props) {
  const { data, ready } = useStudy();
  const [courseSyncError, setCourseSyncError] = useState<string | null>(null);
  const syncCourses = useCallback(async () => {
    try {
      const result = await syncMyCoursesToStudy();
      setCourseSyncError(result.failedCourseIds.length ? "Some assigned courses could not refresh." : null);
    } catch (error: any) {
      setCourseSyncError(error?.message ?? "Could not load assigned courses.");
    }
  }, []);
  useEffect(() => {
    if (!ready) return;
    void syncCourses();
    const unsubscribe = navigation.addListener("focus", syncCourses);
    return unsubscribe;
  }, [ready, syncCourses, navigation]);
  const courseList = data.subjects.map((item) => item.name);
  const nextPlannedSession = todaySessions(data).filter((session) => session.status === "planned").sort((a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99"))[0];
  const defaultCourse = nextPlannedSession ? subjectName(data, nextPlannedSession.subjectId) : courseList[0] ?? "";
  const [course, setCourse] = useState(defaultCourse);
  useEffect(() => { if (!courseList.includes(course)) setCourse(defaultCourse); }, [courseList.join("|"), defaultCourse]);
  // Arriving from a Subject Room / recommendation: preselect the subject (and load the note to read).
  useEffect(() => {
    const p = route.params;
    if (!p?.subject && !p?.notes) return;
    if (p.subject) setCourse(p.subject);
    if (p.notes) setNotes(p.notes);
    navigation.setParams({ subject: undefined, notes: undefined });
  }, [route.params?.subject, route.params?.notes]);
  const startedAt = useRef(0);
  const [minutes, setMinutes] = useState(25);
  const [durationInput, setDurationInput] = useState("25");
  const [themeKey, setThemeKey] = useState<ThemeKey>("light");
  const [notes, setNotes] = useState("");
  const [active, setActive] = useState(false);
  const [breakMins, setBreakMins] = useState(5);
  const [breakInput, setBreakInput] = useState("5");
  const [breakLeft, setBreakLeft] = useState(0); // >0 means a break is running
  const breakEnd = useRef(0);
  const doneToday = data.focus.filter((f) => f.date === dateStr()).length;
  const [remaining, setRemaining] = useState(0);
  const endAt = useRef(0);
  const theme = THEMES[themeKey];

  const stop = (completed = false) => {
    // Log real time spent so Home and analytics reflect actual study, not just intent.
    logFocus(course, Math.round((Date.now() - startedAt.current) / 60000));
    if (completed) {
      const planned = todaySessions(data).filter((s) => s.status === "planned" && subjectName(data, s.subjectId) === course).sort((a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99"))[0];
      if (planned) setSessionStatus(planned.id, "done");
    }
    setActive(false);
    setNotificationsMuted(false);
    deactivateKeepAwake();
    navigation.setOptions({ tabBarStyle: undefined });
  };

  const start = () => {
    if (!course) return Alert.alert("No courses yet", "Your teacher-assigned courses will appear here before you start a focus session.");
    const duration = Number(durationInput);
    const breakDuration = Number(breakInput);
    if (!Number.isInteger(duration) || duration < 1 || duration > 1440) return Alert.alert("Focus duration", "Enter a whole number from 1 to 1440 minutes.");
    if (!Number.isInteger(breakDuration) || breakDuration < 1 || breakDuration > 180) return Alert.alert("Break duration", "Enter a whole number from 1 to 180 minutes.");
    setMinutes(duration);
    setBreakMins(breakDuration);
    startedAt.current = Date.now();
    endAt.current = Date.now() + duration * 60000;
    setRemaining(duration * 60);
    setActive(true);
    setNotificationsMuted(true);
    activateKeepAwakeAsync();
    navigation.setOptions({ tabBarStyle: { display: "none" } }); // hides tabs so you can't wander off
  };

  const confirmExit = () =>
    Alert.alert("End session?", "You're still mid-session. Stay focused a bit longer?", [
      { text: "Keep reading", style: "cancel" },
      { text: "End", style: "destructive", onPress: () => stop() },
    ]);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      const left = Math.max(0, Math.round((endAt.current - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) {
        stop(true);
        Alert.alert("Session complete", `${minutes} minutes of ${course}. Nice focus! Take a ${breakMins}-minute break?`, [
          { text: "Skip break", style: "cancel" },
          { text: "Start break", onPress: () => { breakEnd.current = Date.now() + breakMins * 60000; setBreakLeft(breakMins * 60); } },
        ]);
      }
    }, 1000);
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      confirmExit();
      return true;
    });
    return () => {
      clearInterval(id);
      back.remove();
    };
  }, [active]);

  useEffect(() => {
    if (breakLeft <= 0) return;
    const id = setInterval(() => setBreakLeft(Math.max(0, Math.round((breakEnd.current - Date.now()) / 1000))), 1000);
    return () => clearInterval(id);
  }, [breakLeft > 0]);

  // Safety net: never leave notifications muted if the screen unmounts mid-session.
  useEffect(() => () => { setNotificationsMuted(false); deactivateKeepAwake(); }, []);

  if (breakLeft > 0) {
    return (
      <SafeAreaView style={[styles.safe, { alignItems: "center", justifyContent: "center", padding: spacing.xl }]}>
        <Reveal><Text style={styles.h1}>Break</Text></Reveal>
        <Breathing amount={0.06}><Text style={[type.hero, { color: colors.tealDeep, marginVertical: spacing.lg }]}>{fmt(breakLeft)}</Text></Breathing>
        <Text style={styles.sub}>Stretch, drink water, look away from the screen.</Text>
        <PressableScale style={[styles.start, { alignSelf: "stretch" }]} onPress={() => setBreakLeft(0)}><Text style={styles.startText}>Skip break</Text></PressableScale>
      </SafeAreaView>
    );
  }

  if (active) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
        <StatusBar style={themeKey === "dark" ? "light" : "dark"} />
        <View style={styles.sessionBar}>
          <View>
            <Text style={[styles.sessionSubject, { color: theme.text }]}>{course}</Text>
            <Breathing amount={0.05}><Text style={[styles.sessionTimer, { color: theme.muted }]}>⏱ {fmt(remaining)} left</Text></Breathing>
            <Text style={[styles.sessionTimer, { color: theme.muted }]}>Focus. Your study partner is here.</Text>
          </View>
          <PressableScale style={[styles.pill, { borderColor: theme.muted }]} onPress={confirmExit}>
            <Text style={{ color: theme.text, ...type.label }}>End</Text>
          </PressableScale>
        </View>
        <ScrollView contentContainerStyle={{ ...WRAP, padding: spacing.xl }}>
          <Text style={[styles.reading, { color: theme.text }]}>
            {notes.trim() || "No notes added. Use this time to read from your textbook. The timer and Do-Not-Disturb are running."}
          </Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const Chip = ({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) => (
    <PressableScale style={[styles.chip, on && styles.chipOn]} onPress={onPress}>
      <Text style={[styles.chipText, on && { color: "#fff" }]}>{label}</Text>
    </PressableScale>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={{ ...WRAP, padding: spacing.xl }}>
        <Text style={styles.h1}>Focus</Text>
        <Text style={styles.sub}>A quiet study timer for one course. Choose a course and duration, then read your notes or textbook while the countdown runs.</Text>
        <View style={{ marginTop: spacing.md, padding: spacing.lg, borderRadius: radii.md, backgroundColor: colors.violetTint }}>
          <Text style={[type.bodyMedium, { color: colors.text }]}>What happens when you focus?</Text>
          <Text style={[type.caption, { color: colors.textMuted, marginTop: 4 }]}>Steth keeps this screen awake and mutes Steth notifications. When the timer finishes, your actual study time is recorded and one planned session for that course today is marked complete. If you end early, only the time you spent is recorded. Other apps' notifications are controlled by your phone's Do Not Disturb setting.</Text>
        </View>
        <PressableScale style={[styles.dnd, { marginTop: spacing.sm }]} onPress={() => navigation.getParent()?.navigate("Planner")}>
          <Text style={styles.dndText}>View or edit your study plan →</Text>
        </PressableScale>
        <View style={[styles.row, { marginTop: spacing.lg }]}>
          {[[`${focusMinutes(data, 0, 0)} min`, "today"], [`${doneToday}`, "focus sessions"], [`${focusMinutes(data, 6, 0)} min`, "this week"]].map(([v, k]) => (
            <View key={k} style={styles.stat}><Text style={styles.statV}>{v}</Text><Text style={styles.statK}>{k}</Text></View>
          ))}
        </View>

        <Text style={styles.label}>COURSE</Text>
        {courseList.length ? (
          <View style={styles.row}>{courseList.map((name) => <Chip key={name} label={name} on={course === name} onPress={() => setCourse(name)} />)}</View>
        ) : (
          <Text style={styles.sub}>{ready ? "No courses have been assigned yet. Your teachers' courses will appear here automatically." : "Loading your assigned courses…"}</Text>
        )}
        {!!courseSyncError && <Text style={styles.sub}>{courseSyncError}</Text>}

        <Text style={styles.label}>DURATION</Text>
        <View style={styles.row}>{DURATIONS.map((d) => <Chip key={d} label={`${d} min`} on={minutes === d && durationInput === String(d)} onPress={() => { setMinutes(d); setDurationInput(String(d)); }} />)}</View>
        <TextInput style={[styles.notes, { minHeight: 48, textAlignVertical: "center" }]} value={durationInput} onChangeText={setDurationInput} keyboardType="number-pad" placeholder="Custom focus duration in minutes (1–1440)" placeholderTextColor={colors.textFaint} />

        <Text style={styles.label}>BREAK</Text>
        <View style={styles.row}>{BREAKS.map((b) => <Chip key={b} label={`${b} min`} on={breakMins === b && breakInput === String(b)} onPress={() => { setBreakMins(b); setBreakInput(String(b)); }} />)}</View>
        <TextInput style={[styles.notes, { minHeight: 48, textAlignVertical: "center" }]} value={breakInput} onChangeText={setBreakInput} keyboardType="number-pad" placeholder="Custom break duration in minutes (1–180)" placeholderTextColor={colors.textFaint} />

        <Text style={styles.label}>SCREEN</Text>
        <View style={styles.row}>
          {(Object.keys(THEMES) as ThemeKey[]).map((k) => <Chip key={k} label={THEMES[k].name} on={themeKey === k} onPress={() => setThemeKey(k)} />)}
        </View>

        <Text style={styles.label}>YOUR NOTES (OPTIONAL)</Text>
        <TextInput
          style={styles.notes}
          multiline
          placeholder="Paste or type the notes you want to read…"
          placeholderTextColor={colors.textFaint}
          value={notes}
          onChangeText={setNotes}
        />

        <PressableScale style={styles.start} onPress={start} haptic="medium">
          <Text style={styles.startText}>Start focus session</Text>
        </PressableScale>

        <PressableScale style={styles.dnd} onPress={() => Linking.openSettings()}>
          <Text style={styles.dndText}>
            Note: apps can't block other apps' notifications. For full silence, turn on Do Not Disturb (tap to open settings).
          </Text>
        </PressableScale>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  h1: { ...type.h1, color: colors.text },
  sub: { ...type.body, color: colors.textMuted, marginTop: 4 },
  label: { ...type.label, color: colors.textMuted, marginTop: spacing.xl, marginBottom: spacing.sm },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radii.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  chipOn: { backgroundColor: colors.teal, borderColor: colors.teal },
  chipText: { ...type.bodyMedium, color: colors.text },
  notes: { minHeight: 120, backgroundColor: colors.card, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, textAlignVertical: "top", ...type.body, color: colors.text },
  start: { backgroundColor: colors.teal, borderRadius: radii.md, paddingVertical: spacing.lg, alignItems: "center", marginTop: spacing.xl },
  startText: { ...type.h3, color: "#fff" },
  stat: { flexGrow: 1, width: "30%", backgroundColor: colors.card, borderRadius: radii.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  statV: { ...type.h3, color: colors.text },
  statK: { ...type.caption, color: colors.textMuted },
  dnd: { marginTop: spacing.lg, backgroundColor: colors.violetTint, borderRadius: radii.md, padding: spacing.lg },
  dndText: { ...type.caption, color: colors.textMuted },
  sessionBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.xl, paddingBottom: spacing.sm },
  sessionSubject: { ...type.h2 },
  sessionTimer: { ...type.caption, marginTop: 2 },
  pill: { borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  reading: { fontSize: 18, lineHeight: 30, fontFamily: "Inter_400Regular" },
});
