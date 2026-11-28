import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, Alert, Platform, Modal } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing } from "../theme/tokens";
import { Back, Btn, Card, Chip, Label, Muted, s } from "../components/study/ui";
import {
  useStudy, addSession, setSessionStatus, rescheduleSession, removeSession,
  setPrefs, subjectName, dateStr, addDaysStr, fmtTime12, PlannedSession,
  generateSchedule, applySchedule, recommend, knowledgeGaps, subjectStats,
  accuracyOverall, studyStreak, focusMinutes,
} from "../lib/studyStore";
import { WRAP } from "../components/responsive";
import Dropdown from "../components/Dropdown";
import { syncMyCoursesToStudy } from "../lib/courseApi";
import { requestNotificationPermissions, notificationsAvailable, hasNotificationPermission } from "../lib/notifications";

const DURATIONS = [25, 45, 60, 90];
const localDateString = (d: Date) => String(d.getFullYear()) + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const parseDate = (value: string) => { const parts = value.split("-").map(Number); return new Date(parts[0], parts[1] - 1, parts[2], 12); };
const parseTime = (value: string) => { const parts = value.split(":").map(Number); const d = new Date(); d.setHours(parts[0], parts[1], 0, 0); return d; };
const formatTime = (d: Date) => String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
const dayName = (value: string) => new Date(value + "T12:00:00").toLocaleDateString(undefined, { weekday: "short" });
const dayLabel = (value: string) => value === dateStr() ? "Today" : value === addDaysStr(1) ? "Tomorrow" : new Date(value + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
const timeMinutes = (value: string) => { const parts = value.split(":").map(Number); return parts[0] * 60 + parts[1]; };

function overlaps(data: ReturnType<typeof useStudy>["data"], date: string, time: string, minutes: number, ignoreId?: string) {
  const start = timeMinutes(time);
  return data.sessions.some((item) => {
    if (item.id === ignoreId || item.date !== date || item.status !== "planned") return false;
    const otherStart = timeMinutes(item.time ?? data.prefs.preferredTime);
    return start < otherStart + item.minutes && start + minutes > otherStart;
  });
}

export default function PlannerScreen({ navigation }: any) {
  const { data, ready } = useStudy();
  const [syncError, setSyncError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState(dateStr());
  const [courseId, setCourseId] = useState<string | null>(null);
  const [duration, setDuration] = useState(45);
  const [sessionDate, setSessionDate] = useState<Date>(() => new Date());
  const [sessionTime, setSessionTime] = useState<Date>(() => { const d = new Date(); d.setHours(18, 0, 0, 0); return d; });
  const [picker, setPicker] = useState<"date" | "time" | null>(null);
  const [editing, setEditing] = useState<PlannedSession | null>(null);
  const [editDate, setEditDate] = useState<Date>(new Date());
  const [editTime, setEditTime] = useState<Date>(new Date());
  const [editPicker, setEditPicker] = useState<"date" | "time" | null>(null);
  const [remindersBusy, setRemindersBusy] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [planNotice, setPlanNotice] = useState<string | null>(null);

  const syncCourses = useCallback(async () => {
    try {
      const result = await syncMyCoursesToStudy();
      setSyncError(result.failedCourseIds.length ? String(result.failedCourseIds.length) + " course(s) could not refresh. Try again." : null);
    } catch (error: any) {
      setSyncError(error?.message ?? "Could not load assigned courses.");
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    void syncCourses();
    const checkPermission = () => { void hasNotificationPermission().then(setPermissionGranted); };
    checkPermission();
    const unsubscribe = navigation.addListener("focus", () => { syncCourses(); checkPermission(); });
    return unsubscribe;
  }, [ready, syncCourses, navigation]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysStr(i)), []);
  const sessions = data.sessions.filter((item) => item.date === selectedDay)
    .sort((a, b) => (a.time ?? data.prefs.preferredTime).localeCompare(b.time ?? data.prefs.preferredTime));
  const plannedCount = sessions.filter((item) => item.status === "planned").length;
  const doneCount = sessions.filter((item) => item.status === "done").length;
  const completedThisWeek = data.sessions.filter((item) => days.includes(item.date) && item.status === "done").length;
  const plannedThisWeek = data.sessions.filter((item) => days.includes(item.date) && item.status === "planned").length;
  const chosenCourse = courseId ?? data.subjects[0]?.id;
  const nextAction = useMemo(() => recommend(data), [data]);
  const learningGaps = useMemo(() => knowledgeGaps(data).slice(0, 4), [data]);
  const coursePerformance = useMemo(() => subjectStats(data), [data]);
  const suggestedSessions = useMemo(() => generateSchedule(data, 7), [data]);
  const weekFocusMinutes = focusMinutes(data, 6, 0);
  const overallAccuracy = accuracyOverall(data);
  const currentStreak = studyStreak(data);
  const reviewsDue = data.cards.filter((card) => card.due <= dateStr()).length +
    data.topics.filter((topic) => !!topic.nextReview && topic.nextReview <= dateStr()).length;

  const openNextAction = () => {
    const params = nextAction.params ?? {};
    switch (nextAction.target) {
      case "Study": navigation.navigate("Main", { screen: "Study", params }); break;
      case "PracticeSession": navigation.navigate("PracticeSession", params); break;
      case "Subject": navigation.navigate("Subject", params); break;
      case "Cards": navigation.navigate("Cards"); break;
      case "Progress": navigation.navigate("Progress"); break;
      case "StudySetup": navigation.navigate("StudySetup"); break;
      case "Practice": navigation.navigate("Main", { screen: "Practice" }); break;
      default: navigation.navigate("Main", { screen: "Learn" }); break;
    }
  };

  const buildSevenDayPlan = () => {
    if (!suggestedSessions.length) {
      setPlanNotice("No new sessions fit your current timetable and daily study-time limit. Remove or move a session, or increase your daily study time in Study setup.");
      return;
    }
    applySchedule(suggestedSessions);
    setSelectedDay(dateStr());
    setSessionDate(new Date());
    setPlanNotice(`Added ${suggestedSessions.length} focused study sessions across the next seven days. You can edit any session below.`);
  };

  const startFocus = (item: PlannedSession) => {
    navigation.navigate("Main", { screen: "Study", params: { subject: subjectName(data, item.subjectId) } });
  };

  const toggleReminders = async () => {
    if (data.prefs.notif.sessions && permissionGranted) {
      setPrefs({ notif: { ...data.prefs.notif, sessions: false } });
      return;
    }
    if (!notificationsAvailable) {
      Alert.alert("Install the Steth app", "Scheduled study reminders are not available in Expo Go on Android. Install a development or production build to receive them.");
      return;
    }
    setRemindersBusy(true);
    try {
      const granted = await requestNotificationPermissions();
      setPermissionGranted(granted);
      if (!granted) {
        Alert.alert("Notifications are off", "Allow notifications for Steth in your phone settings, then turn study reminders on again.");
        return;
      }
      setPrefs({ notif: { ...data.prefs.notif, sessions: true } });
      Alert.alert("Study reminders enabled", "Steth will notify you when a planned study session is due.");
    } catch {
      Alert.alert("Could not enable reminders", "Please check Steth's notification permission in your phone settings.");
    } finally {
      setRemindersBusy(false);
    }
  };

  const add = () => {
    const date = localDateString(sessionDate);
    const time = formatTime(sessionTime);
    const now = new Date();
    if (!chosenCourse) return Alert.alert("Choose a course", "Select one of your courses first.");
    if (date < dateStr() || (date === dateStr() && timeMinutes(time) <= now.getHours() * 60 + now.getMinutes())) {
      return Alert.alert("Choose a future time", "A study session must start in the future.");
    }
    if (timeMinutes(time) + duration > 1440) return Alert.alert("Choose an earlier time", "This session would continue past midnight.");
    if (overlaps(data, date, time, duration)) return Alert.alert("Time conflict", "You already have a planned session during this time.");
    addSession(chosenCourse, duration, date, time);
    setSelectedDay(date);
    setPicker(null);
    Alert.alert("Session added", subjectName(data, chosenCourse) + " is planned for " + dayLabel(date) + " at " + fmtTime12(time) + ".");
  };

  const saveEdit = () => {
    if (!editing) return;
    const date = localDateString(editDate);
    const time = formatTime(editTime);
    const now = new Date();
    if (date < dateStr() || (date === dateStr() && timeMinutes(time) <= now.getHours() * 60 + now.getMinutes())) {
      return Alert.alert("Choose a future time", "A planned session must start in the future.");
    }
    if (timeMinutes(time) + editing.minutes > 1440) return Alert.alert("Choose an earlier time", "This session would continue past midnight.");
    if (overlaps(data, date, time, editing.minutes, editing.id)) return Alert.alert("Time conflict", "Another planned session already uses that time.");
    rescheduleSession(editing.id, date, time);
    setSelectedDay(date);
    setEditing(null);
    setEditPicker(null);
  };

  const Session = ({ item }: { item: PlannedSession }) => {
    const done = item.status === "done";
    const skipped = item.status === "skipped";
    const time = item.time ?? data.prefs.preferredTime;
    return (
      <Card style={{ marginBottom: spacing.sm, opacity: done || skipped ? 0.75 : 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flex: 1, paddingRight: spacing.sm }}>
            <Text style={s.h3}>{subjectName(data, item.subjectId)}</Text>
            <Muted>{dayLabel(item.date)} · {fmtTime12(time)} · {item.minutes} minutes</Muted>
          </View>
          <Text style={{ color: done ? colors.success : skipped ? colors.textFaint : colors.teal, fontWeight: "700" }}>
            {done ? "Completed" : skipped ? "Skipped" : "Planned"}
          </Text>
        </View>
        {!done && !skipped ? (
          <>
            <View style={[s.row, { marginTop: spacing.md }]}>
              <Chip label="Start study" on onPress={() => startFocus(item)} />
              <Chip label="Done" on onPress={() => setSessionStatus(item.id, "done")} />
              <Chip label="Remove" on={false} onPress={() => Alert.alert("Remove session?", "This will remove it from your timetable.", [{ text: "Keep", style: "cancel" }, { text: "Remove", style: "destructive", onPress: () => removeSession(item.id) }])} />
            </View>
            <View style={{ marginTop: spacing.sm }}>
              <Btn ghost label="Edit date & time" onPress={() => { setEditing(item); setEditDate(parseDate(item.date)); setEditTime(parseTime(time)); }} />
            </View>
          </>
        ) : (
          <View style={[s.row, { marginTop: spacing.md }]}>
            <Chip label="Undo" on={false} onPress={() => setSessionStatus(item.id, "planned")} />
          </View>
        )}
      </Card>
    );
  };

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={{ ...WRAP, padding: spacing.xl, paddingBottom: spacing.xxxl * 2 }} keyboardShouldPersistTaps="handled">
        <Back onPress={() => navigation.goBack()} />
        <Text style={s.h1}>Study plan</Text>
        <Muted style={{ marginTop: spacing.xs }}>A practical plan to help you understand your courses, remember what you learn and improve your test performance — not just fill your calendar.</Muted>

        <Card style={{ marginTop: spacing.lg, borderColor: colors.teal }}>
          <Label>YOUR LEARNING SNAPSHOT</Label>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm }}>
            <View style={{ width: "48%", padding: spacing.sm, borderRadius: 12, backgroundColor: colors.card }}>
              <Text style={s.h2}>{overallAccuracy === null ? "—" : `${overallAccuracy}%`}</Text>
              <Muted>Quiz accuracy</Muted>
            </View>
            <View style={{ width: "48%", padding: spacing.sm, borderRadius: 12, backgroundColor: colors.card }}>
              <Text style={s.h2}>{currentStreak}</Text>
              <Muted>Study-day streak</Muted>
            </View>
            <View style={{ width: "48%", padding: spacing.sm, borderRadius: 12, backgroundColor: colors.card }}>
              <Text style={s.h2}>{weekFocusMinutes >= 60 ? `${Math.floor(weekFocusMinutes / 60)}h ${weekFocusMinutes % 60}m` : `${weekFocusMinutes}m`}</Text>
              <Muted>Focused this week</Muted>
            </View>
            <View style={{ width: "48%", padding: spacing.sm, borderRadius: 12, backgroundColor: colors.card }}>
              <Text style={s.h2}>{reviewsDue}</Text>
              <Muted>Reviews due</Muted>
            </View>
          </View>
          <Muted style={{ marginTop: spacing.sm }}>{coursePerformance.filter((course) => course.accuracy !== null).length} course(s) have enough quiz/review data to estimate performance. Keep practising to make these insights more accurate.</Muted>
          <Btn ghost label="Personalise my study goals" onPress={() => navigation.navigate("StudySetup")} />
        </Card>

        <Card style={{ marginTop: spacing.sm }}>
          <Label>YOUR NEXT BEST ACTION</Label>
          <Text style={[s.h3, { marginTop: spacing.xs }]}>{nextAction.text}</Text>
          {!!nextAction.steps?.length && <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
            {nextAction.steps.map((step, index) => <Muted key={`${index}-${step}`}>{index + 1}. {step}</Muted>)}
          </View>}
          <View style={{ marginTop: spacing.sm }}><Btn label={nextAction.cta} onPress={openNextAction} /></View>
        </Card>

        <Card style={{ marginTop: spacing.sm }}>
          <Label>BUILD A BALANCED 7-DAY PLAN</Label>
          <Text style={[s.h3, { marginTop: spacing.xs }]}>Spend more time on the courses that need it</Text>
          <Muted style={{ marginTop: spacing.xs }}>Steth uses your quiz performance, upcoming exam dates, overdue topics, missed sessions and daily study-time preference to suggest realistic sessions.</Muted>
          <Muted style={{ marginTop: spacing.sm }}>{suggestedSessions.length ? `${suggestedSessions.length} suggested session(s) are ready to add to your timetable.` : "No additional sessions are available from your current timetable and daily time budget."}</Muted>
          <View style={{ marginTop: spacing.sm }}><Btn label={suggestedSessions.length ? "Add my suggested study sessions" : "No new sessions to add"} disabled={!suggestedSessions.length} onPress={buildSevenDayPlan} /></View>
          {!!planNotice && <Muted style={{ marginTop: spacing.sm, color: colors.teal }}>{planNotice}</Muted>}
        </Card>

        {!!learningGaps.length && <Card style={{ marginTop: spacing.sm }}>
          <Label>TOPICS THAT NEED ATTENTION</Label>
          <Muted style={{ marginTop: spacing.xs }}>Use these as your revision priorities. They come from your quiz answers, flashcard reviews and topic review dates.</Muted>
          {learningGaps.map((gap) => <View key={`${gap.kind}-${gap.subjectId}-${gap.topicId ?? "none"}`} style={{ marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
            <Text style={s.h3}>{gap.title}</Text>
            <Muted>{gap.detail}</Muted>
            <View style={{ marginTop: spacing.xs, alignSelf: "flex-start" }}><Chip label="Open course" on={false} onPress={() => navigation.navigate("Subject", { subjectId: gap.subjectId })} /></View>
          </View>)}
        </Card>}

        <Card style={{ marginTop: spacing.md }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View style={{ flex: 1, paddingRight: spacing.sm }}>
              <Label>STUDY REMINDERS</Label>
              <Muted>{data.prefs.notif.sessions && permissionGranted ? "Phone alerts are enabled for planned sessions." : "Turn on phone alerts for your planned sessions."}</Muted>
            </View>
            <Btn label={remindersBusy ? "Please wait" : data.prefs.notif.sessions && permissionGranted ? "Turn off" : "Turn on"} ghost={data.prefs.notif.sessions && permissionGranted} disabled={remindersBusy} onPress={toggleReminders} />
          </View>
          <View style={[s.row, { marginTop: spacing.sm, alignItems: "center", justifyContent: "space-between" }]}>
            <View style={{ flex: 1, paddingRight: spacing.sm }}>
              <Text style={s.h3}>Daily study check-in</Text>
              <Muted>At 8:00 PM, get a gentle reminder if you have not logged study time today.</Muted>
            </View>
            <Chip label={data.prefs.notif.dailyCheckIn ? "On" : "Off"} on={data.prefs.notif.dailyCheckIn} onPress={() => setPrefs({ notif: { ...data.prefs.notif, dailyCheckIn: !data.prefs.notif.dailyCheckIn } })} />
          </View>
        </Card>

        <Card style={{ marginTop: spacing.sm }}>
          <Label>THIS WEEK</Label>
          <View style={[s.row, { marginTop: spacing.sm, justifyContent: "space-between" }]}>
            <View><Text style={s.h2}>{completedThisWeek}</Text><Muted>Completed</Muted></View>
            <View><Text style={s.h2}>{plannedThisWeek}</Text><Muted>Still planned</Muted></View>
            <View><Text style={s.h2}>{completedThisWeek + plannedThisWeek}</Text><Muted>Total sessions</Muted></View>
          </View>
        </Card>

        {!!syncError && <Muted style={{ color: colors.danger, marginTop: spacing.sm }}>{syncError}</Muted>}

        <Label>CHOOSE A DAY</Label>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[s.row, { paddingVertical: spacing.xs }]}>
          {days.map((day) => {
            const active = selectedDay === day;
            return <Chip key={day} label={dayName(day) + "\n" + String(Number(day.slice(-2)))} on={active} onPress={() => { setSelectedDay(day); setSessionDate(parseDate(day)); }} />;
          })}
        </ScrollView>

        <View style={[s.row, { alignItems: "center", justifyContent: "space-between", marginTop: spacing.sm }]}>
          <View>
            <Text style={s.h2}>{dayLabel(selectedDay)}</Text>
            <Muted>{sessions.length} session{sessions.length === 1 ? "" : "s"} · {doneCount} completed · {plannedCount} remaining</Muted>
          </View>
        </View>

        {sessions.length ? sessions.map((item) => <Session key={item.id} item={item} />) : (
          <Card style={{ alignItems: "center", paddingVertical: spacing.xl }}>
            <Text style={s.h3}>No study sessions planned</Text>
            <Muted style={{ textAlign: "center", marginTop: spacing.xs }}>Keep this day realistic. Add a course and a time you can genuinely protect.</Muted>
          </Card>
        )}

        <Label>ADD A STUDY SESSION</Label>
        {data.subjects.length === 0 ? (
          <Card><Muted>Your courses will appear here after your lecturer assigns them.</Muted></Card>
        ) : (
          <Card>
            <Label>COURSE</Label>
            <Dropdown value={chosenCourse ?? null} options={data.subjects.map((item) => ({ value: item.id, label: item.name }))} onSelect={setCourseId} placeholder="Choose a course" title="Choose a course" searchable />
            <Label>DURATION</Label>
            <View style={[s.row, { marginTop: spacing.xs }]}>
              {DURATIONS.map((value) => <Chip key={value} label={value + " min"} on={duration === value} onPress={() => setDuration(value)} />)}
            </View>
            <Label>DATE AND START TIME</Label>
            <View style={[s.row, { marginTop: spacing.xs }]}>
              <Chip label={"Date · " + localDateString(sessionDate)} on={false} onPress={() => setPicker("date")} />
              <Chip label={"Time · " + fmtTime12(formatTime(sessionTime))} on={false} onPress={() => setPicker("time")} />
            </View>
            {picker && (
              <DateTimePicker value={picker === "date" ? sessionDate : sessionTime} mode={picker} minimumDate={picker === "date" ? new Date() : undefined} display={Platform.OS === "ios" ? "spinner" : "default"} onChange={(event, value) => {
                if (event.type === "dismissed") { setPicker(null); return; }
                if (value) { if (picker === "date") setSessionDate(value); else setSessionTime(value); }
                if (Platform.OS !== "ios") setPicker(null);
              }} />
            )}
            {Platform.OS === "ios" && picker && <Chip label="Done" on={false} onPress={() => setPicker(null)} />}
            <Btn label="Add to timetable" onPress={add} />
          </Card>
        )}
      </ScrollView>

      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => { setEditing(null); setEditPicker(null); }}>
        <View style={{ flex: 1, justifyContent: "center", padding: spacing.lg, backgroundColor: "rgba(0,0,0,0.45)" }}>
          <Card style={{ padding: spacing.lg }}>
            <Text style={s.h2}>Edit study date & time</Text>
            <Muted style={{ marginTop: spacing.xs }}>The course and duration stay the same. The new time must be in the future and must not overlap another planned session.</Muted>
            <View style={[s.row, { marginTop: spacing.md }]}>
              <Chip label={"Date · " + localDateString(editDate)} on={editPicker === "date"} onPress={() => setEditPicker("date")} />
              <Chip label={"Time · " + fmtTime12(formatTime(editTime))} on={editPicker === "time"} onPress={() => setEditPicker("time")} />
            </View>
            {editPicker && <DateTimePicker value={editPicker === "date" ? editDate : editTime} mode={editPicker} minimumDate={editPicker === "date" ? new Date() : undefined} display={Platform.OS === "ios" ? "spinner" : "default"} onChange={(event, value) => {
              if (event.type === "dismissed") { setEditPicker(null); return; }
              if (value) { if (editPicker === "date") setEditDate(value); else setEditTime(value); }
              if (Platform.OS !== "ios") setEditPicker(null);
            }} />}
            {Platform.OS === "ios" && editPicker && <Chip label="Done" on={false} onPress={() => setEditPicker(null)} />}
            <View style={[s.row, { marginTop: spacing.md }]}>
              <View style={{ flex: 1 }}><Btn label="Save changes" onPress={saveEdit} /></View>
              <View style={{ flex: 1 }}><Btn label="Cancel" ghost onPress={() => { setEditing(null); setEditPicker(null); }} /></View>
            </View>
          </Card>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
