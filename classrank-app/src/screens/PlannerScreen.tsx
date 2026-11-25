import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, Alert, Platform, Modal } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing } from "../theme/tokens";
import { Back, Btn, Card, Chip, Label, Muted, s } from "../components/study/ui";
import {
  useStudy, addSession, setSessionStatus, rescheduleSession, removeSession,
  setPrefs, subjectName, dateStr, addDaysStr, fmtTime12, PlannedSession,
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
            <Muted>{fmtTime12(time)} · {item.minutes} minutes</Muted>
          </View>
          <Text style={{ color: done ? colors.success : skipped ? colors.textFaint : colors.teal, fontWeight: "700" }}>
            {done ? "Completed" : skipped ? "Skipped" : "Planned"}
          </Text>
        </View>
        {!done && !skipped ? (
          <View style={[s.row, { marginTop: spacing.md }]}>
            <Chip label="Start study" on onPress={() => startFocus(item)} />
            <Chip label="Done" on onPress={() => setSessionStatus(item.id, "done")} />
            <Chip label="Edit" on={false} onPress={() => { setEditing(item); setEditDate(parseDate(item.date)); setEditTime(parseTime(time)); }} />
            <Chip label="Remove" on={false} onPress={() => Alert.alert("Remove session?", "This will remove it from your timetable.", [{ text: "Keep", style: "cancel" }, { text: "Remove", style: "destructive", onPress: () => removeSession(item.id) }])} />
          </View>
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
        <Text style={s.h1}>Study timetable</Text>
        <Muted style={{ marginTop: spacing.xs }}>Plan focused study time around your lectures, assignments and exams. Small, regular sessions are easier to keep than last-minute cramming.</Muted>

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
            <Chip label={data.prefs.notif.missed ? "On" : "Off"} on={data.prefs.notif.missed} onPress={() => setPrefs({ notif: { ...data.prefs.notif, missed: !data.prefs.notif.missed } })} />
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
            <Text style={s.h2}>Reschedule session</Text>
            <Muted style={{ marginTop: spacing.xs }}>The course and duration will stay the same.</Muted>
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
