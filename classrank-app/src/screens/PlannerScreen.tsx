import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, TextInput, Alert, Platform, Modal } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing } from "../theme/tokens";
import PressableScale from "../components/animated/PressableScale";
import { Back, Btn, Card, Chip, Label, Muted, s } from "../components/study/ui";
import {
  useStudy, addSession, setSessionStatus, rescheduleSession, removeSession, applySchedule,
  generateSchedule, missedSessions, subjectName, topicName, daysUntil, dateStr, addDaysStr, fmtTime12, PlannedSession,
} from "../lib/studyStore";
import { WRAP } from "../components/responsive";
import Dropdown from "../components/Dropdown";
import { syncMyCoursesToStudy } from "../lib/courseApi";

const MINUTES = [10, 20, 30, 45];
const localDateString = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseDate = (value?: string) => { if (!value) return new Date(); const [y, m, d] = value.split("-").map(Number); return new Date(y, m - 1, d, 12); };
const parseTime = (value: string) => { const [h, m] = value.split(":").map(Number); const d = new Date(); d.setHours(h || 0, m || 0, 0, 0); return d; };
const formatTime = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const dayLabel = (d: string) => (d === dateStr() ? "Today" : d === addDaysStr(1) ? "Tomorrow" : new Date(d + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }));
const timeMinutes = (value: string) => { const [h, m] = value.split(":").map(Number); return h * 60 + m; };
const timeFromMinutes = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;

function hasSessionConflict(data: ReturnType<typeof useStudy>["data"], date: string, time: string, minutes: number, ignoreId?: string) {
  const start = timeMinutes(time), end = start + minutes;
  return data.sessions.some((session) => {
    if (session.id === ignoreId || session.date !== date || session.status !== "planned") return false;
    const otherStart = timeMinutes(session.time ?? data.prefs.preferredTime);
    return start < otherStart + session.minutes && end > otherStart;
  });
}

function nextAvailableSlot(data: ReturnType<typeof useStudy>["data"], minutes: number) {
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  let date = dateStr();
  let start = Math.max(timeMinutes(data.prefs.preferredTime), Math.ceil((nowMinutes + 15) / 15) * 15);
  for (let day = 0; day < 7; day++) {
    const sessions = data.sessions.filter((session) => session.date === date && session.status === "planned");
    for (let attempt = 0; attempt <= sessions.length; attempt++) {
      if (start + minutes > 24 * 60) break;
      const conflict = sessions.map((session) => {
        const from = timeMinutes(session.time ?? data.prefs.preferredTime);
        return { from, to: Math.min(24 * 60, from + session.minutes) };
      }).filter((slot) => start < slot.to && start + minutes > slot.from).sort((a, b) => a.to - b.to)[0];
      if (!conflict) return { date, time: timeFromMinutes(start) };
      start = Math.ceil(conflict.to / 15) * 15;
    }
    date = addDaysStr(1, parseDate(date));
    start = timeMinutes(data.prefs.preferredTime);
  }
  return null;
}

export default function PlannerScreen({ navigation }: any) {
  const { data, ready } = useStudy();
  const [syncError, setSyncError] = useState<string | null>(null);
  const syncCourses = useCallback(async () => {
    try {
      const result = await syncMyCoursesToStudy();
      setSyncError(result.failedCourseIds.length ? `${result.failedCourseIds.length} course(s) could not refresh. Try again.` : null);
    } catch (error: any) {
      setSyncError(error?.message ?? "Could not load assigned courses.");
    }
  }, []);
  useEffect(() => {
    if (!ready) return;
    void syncCourses();
    const unsubscribe = navigation.addListener("focus", syncCourses);
    return unsubscribe;
  }, [ready, syncCourses, navigation]);
  const [pickId, setPickId] = useState<string | null>(null);
  const [mins, setMins] = useState(20);
  const [customMins, setCustomMins] = useState("20");
  const [offset, setOffset] = useState(0);
  const [sessionDate, setSessionDate] = useState<Date>(new Date());
  const [sessionTime, setSessionTime] = useState<Date>(() => parseTime(data.prefs.preferredTime));
  const [sessionPicker, setSessionPicker] = useState<"date" | "time" | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editPicker, setEditPicker] = useState<"date" | "time" | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const chosen = pickId ?? data.subjects[0]?.id;
  const missed = missedSessions(data);
  const days = Array.from({ length: 7 }, (_, i) => addDaysStr(i));
  const upcoming = (d: string) => data.sessions.filter((x) => x.date === d).sort((a, b) => (a.time ?? "99").localeCompare(b.time ?? "99"));
  const nextSession = useMemo(() => data.sessions
    .filter((x) => x.status === "planned")
    .map((x) => ({ ...x, startsAt: new Date(`${x.date}T${x.time ?? data.prefs.preferredTime}:00`).getTime() }))
    .filter((x) => x.startsAt > clockNow)
    .sort((a, b) => a.startsAt - b.startsAt)[0] ?? null, [data.sessions, data.prefs.preferredTime, clockNow]);
  const countdown = nextSession ? (() => {
    const totalSeconds = Math.max(0, Math.floor((nextSession.startsAt - clockNow) / 1000));
    const daysLeft = Math.floor(totalSeconds / 86400);
    const hoursLeft = Math.floor((totalSeconds % 86400) / 3600);
    const minutesLeft = Math.floor((totalSeconds % 3600) / 60);
    const secondsLeft = totalSeconds % 60;
    return daysLeft > 0 ? `${daysLeft}d ${hoursLeft}h ${minutesLeft}m` : `${hoursLeft}h ${minutesLeft}m ${secondsLeft}s`;
  })() : null;

  const suggest = () => {
    const plan = generateSchedule(data, 7);
    if (!plan.length) return Alert.alert("Nothing to suggest", data.subjects.length ? "Your next 7 days are already full for your daily study time." : "Wait for your teacher to assign courses.");
    const preview = plan.slice(0, 6).map((p) => `${dayLabel(p.date)} ${fmtTime12(p.time)} · ${subjectName(data, p.subjectId)}${p.topicId ? ` (${topicName(data, p.topicId)})` : ""}, ${p.minutes} min`).join("\n");
    Alert.alert(`Suggested week · ${plan.length} sessions`, `${preview}${plan.length > 6 ? `\n…and ${plan.length - 6} more` : ""}\n\nBased on your exams, weak areas, missed sessions and ${data.prefs.dailyMinutes} min/day.`, [
      { text: "Not now", style: "cancel" }, { text: "Add to planner", onPress: () => applySchedule(plan) },
    ]);
  };


  const Session = ({ x }: { x: PlannedSession }) => (
    <Card style={{ flexDirection: "row", alignItems: "center" }}>
      <View style={{ flex: 1 }}>
        <Text style={[s.h3, x.status !== "planned" && { opacity: 0.5 }]}>{subjectName(data, x.subjectId)} · {x.minutes} min</Text>
        <Muted>{x.time ? `${fmtTime12(x.time)} · ` : ""}{x.topicId ? `${topicName(data, x.topicId)} · ` : ""}{x.status === "planned" ? "Planned" : x.status === "done" ? "Completed" : "Skipped"}</Muted>
      </View>
      {x.status === "planned" ? (
        <View style={{ gap: 6 }}>
          <View style={s.row}>
            <Chip label="Start focus" on onPress={() => navigation.navigate("Main", { screen: "Study", params: { subject: subjectName(data, x.subjectId) } })} />
            <Chip label="Done" on onPress={() => setSessionStatus(x.id, "done")} />
            <Chip label="Edit date & time" on={false} onPress={() => { setSessionDate(parseDate(x.date)); setSessionTime(parseTime(x.time ?? data.prefs.preferredTime)); setEditingSessionId(x.id); setEditPicker("date"); }} />
          </View>
          <View style={s.row}>
            <Chip label="Skip" on={false} onPress={() => setSessionStatus(x.id, "skipped")} />
            <Chip label="Remove session" on={false} onPress={() => removeSession(x.id)} />
          </View>
        </View>
      ) : (
        <Chip label="Undo" on={false} onPress={() => setSessionStatus(x.id, "planned")} />
      )}
    </Card>
  );

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={{ ...WRAP, padding: spacing.xl, paddingBottom: spacing.xxxl * 2 }} keyboardShouldPersistTaps="handled">
        <Back onPress={() => navigation.goBack()} />
        <Text style={s.h1}>Study planner</Text>
        <Muted style={{ marginTop: spacing.xs }}>Your personal timetable for studying. Choose a course, decide what day and time you will study, then follow your sessions and track what you complete. It helps you spread revision across the week instead of cramming before an exam.</Muted>
        <Card style={{ marginTop: spacing.md, backgroundColor: colors.card }}>
          <Label>NEXT STUDY SESSION</Label>
          {nextSession ? <>
            <Text style={[s.h2, { color: colors.text, marginTop: spacing.xs }]}>{subjectName(data, nextSession.subjectId)}</Text>
            <Text style={[s.h1, { color: colors.teal, marginTop: spacing.xs }]}>{countdown}</Text>
            <Muted>Time until your session · {dayLabel(nextSession.date)} at {fmtTime12(nextSession.time ?? data.prefs.preferredTime)} · {nextSession.minutes} minutes</Muted>
            <View style={[s.row, { marginTop: spacing.sm }]}>
              <Chip label="Start focus" on onPress={() => navigation.navigate("Main", { screen: "Study", params: { subject: subjectName(data, nextSession.subjectId) } })} />
            </View>
          </> : <>
            <Text style={[s.h3, { marginTop: spacing.xs }]}>No upcoming session yet</Text>
            <Muted>Add a study session below or use “Suggest my week” to build a timetable from your courses.</Muted>
          </>}
        </Card>
        <Card style={{ marginTop: spacing.sm }}>
          <Label>HOW TO USE YOUR PLANNER</Label>
          <Muted>1. Add a session for a course and choose its date, start time and duration. 2. When it is time, tap Start focus and study your notes. 3. Mark it Done when you finish, or reschedule it if plans change. Your timetable and countdown update automatically.</Muted>
        </Card>
        <Btn ghost label="Suggest my week" onPress={suggest} disabled={!data.subjects.length} />
        {!!syncError && <Muted style={{ color: colors.danger, marginTop: spacing.sm }}>{syncError}</Muted>}

        <Label>YOUR COURSES</Label>
        {data.subjects.length === 0 ? (
          <Muted>No courses have been assigned yet. Courses published by your teachers will appear here automatically.</Muted>
        ) : data.subjects.map((x) => (
          <Card key={x.id}>
            <PressableScale onPress={() => navigation.navigate("Subject", { subjectId: x.id })}>
              <Text style={s.h3}>{x.name}</Text>
              {x.examDate && <Muted>{daysUntil(x.examDate) >= 0 ? `Exam in ${daysUntil(x.examDate)} days` : "Exam passed"} · {x.examDate}</Muted>}
              <Muted>{x.courseId ? "Assigned by your teacher · fixed" : "Saved course · fixed"}</Muted>
            </PressableScale>
          </Card>
        ))}

        {missed.length > 0 && (
          <>
            <Label>MISSED</Label>
            {missed.map((x) => (
              <Card key={x.id} style={{ flexDirection: "row", alignItems: "center", backgroundColor: colors.emberTint }}>
                <View style={{ flex: 1 }}><Text style={s.h3}>{subjectName(data, x.subjectId)} · {x.minutes} min</Text><Muted>{dayLabel(x.date)}</Muted></View>
                <Chip label="Find next free time" on onPress={() => {
                  const slot = nextAvailableSlot(data, x.minutes);
                  if (!slot) return Alert.alert("No free time found", "There is no open slot in the next 7 days. Edit or skip another session first.");
                  rescheduleSession(x.id, slot.date, slot.time);
                }} />
              </Card>
            ))}
          </>
        )}

        {days.map((d) => {
          const list = upcoming(d);
          if (!list.length) return null;
          return (
            <View key={d}>
              <Label>{dayLabel(d).toUpperCase()}</Label>
              {list.length === 0 && <Muted>No sessions planned yet.</Muted>}
              {list.map((x) => <Session key={x.id} x={x} />)}
            </View>
          );
        })}

        {data.subjects.length > 0 && (
          <>
            <Label>ADD A SESSION</Label>
            <View style={s.row}>{days.slice(0, 4).map((d, i) => <Chip key={d} label={i === 0 ? "Today" : i === 1 ? "Tomorrow" : dayLabel(d).split(",")[0]} on={offset === i} onPress={() => { setOffset(i); setSessionDate(parseDate(d)); }} />)}</View>
            <View style={{ marginTop: spacing.sm }}>
              <Dropdown
                value={chosen ?? null}
                options={data.subjects.map((x) => ({ value: x.id, label: x.name }))}
                onSelect={setPickId}
                placeholder="Choose a course for this session"
                title="Choose a course"
                searchable
              />
            </View>
            <View style={[s.row, { marginTop: spacing.sm }]}>{MINUTES.map((m) => <Chip key={m} label={`${m} min`} on={mins === m} onPress={() => { setMins(m); setCustomMins(String(m)); }} />)}</View>
            <TextInput style={s.input} value={customMins} onChangeText={setCustomMins} placeholder="Session length in minutes" placeholderTextColor={colors.textFaint} keyboardType="number-pad" />
            <View style={s.row}>
              <Chip label={`Date · ${localDateString(sessionDate)}`} on={false} onPress={() => setSessionPicker("date")} />
              <Chip label={`Time · ${fmtTime12(formatTime(sessionTime))}`} on={false} onPress={() => setSessionPicker("time")} />
            </View>
            <Btn label="Add session" onPress={() => {
                const duration = Number(customMins);
                if (!Number.isInteger(duration) || duration < 1 || duration > 1440) return Alert.alert("Session length", "Enter a whole number from 1 to 1440 minutes.");
                if (!chosen) return;
                const date = localDateString(sessionDate), time = formatTime(sessionTime), start = timeMinutes(time);
                if (date < dateStr() || (date === dateStr() && start <= new Date().getHours() * 60 + new Date().getMinutes())) return Alert.alert("Choose a future time", "A planned session must be scheduled for a future time.");
                if (start + duration > 24 * 60) return Alert.alert("Time range", "This session would run past midnight. Choose an earlier start time.");
                if (hasSessionConflict(data, date, time, duration)) return Alert.alert("Time conflict", "Another planned session already overlaps this time. Choose a different time.");
                addSession(chosen, duration, date, time);
              }} />
            {sessionPicker && <>
              <DateTimePicker value={sessionPicker === "date" ? sessionDate : sessionTime} mode={sessionPicker} minimumDate={sessionPicker === "date" ? new Date() : undefined} display={Platform.OS === "ios" ? "spinner" : "default"} onChange={(event, value) => {
                if (event.type === "dismissed") { setSessionPicker(null); return; }
                if (value) { if (sessionPicker === "date") setSessionDate(value); else setSessionTime(value); }
                if (Platform.OS !== "ios") setSessionPicker(null);
              }} />
              {Platform.OS === "ios" && <Chip label="Done" on={false} onPress={() => setSessionPicker(null)} />}
            </>}

          </>
        )}

      </ScrollView>
      <Modal visible={!!editingSessionId} transparent animationType="slide" onRequestClose={() => { setEditingSessionId(null); setEditPicker(null); }}>
        <View style={{ flex: 1, justifyContent: "center", padding: spacing.lg, backgroundColor: "rgba(0,0,0,0.45)" }}>
          <Card style={{ padding: spacing.lg }}>
            <Text style={s.h2}>Reschedule study session</Text>
            <Muted style={{ marginTop: 4 }}>Choose a new date and start time. Your session duration and course will stay the same.</Muted>
            <View style={[s.row, { marginTop: spacing.md }]}>
              <Chip label={`Date · ${localDateString(sessionDate)}`} on={editPicker === "date"} onPress={() => setEditPicker("date")} />
              <Chip label={`Time · ${fmtTime12(formatTime(sessionTime))}`} on={editPicker === "time"} onPress={() => setEditPicker("time")} />
            </View>
            {editPicker && <DateTimePicker value={editPicker === "date" ? sessionDate : sessionTime} mode={editPicker} minimumDate={editPicker === "date" ? new Date() : undefined} display={Platform.OS === "ios" ? "spinner" : "default"} onChange={(event, value) => {
              if (event.type === "dismissed") { setEditPicker(null); return; }
              if (value) { if (editPicker === "date") setSessionDate(value); else setSessionTime(value); }
              if (Platform.OS !== "ios") setEditPicker(null);
            }} />}
            {Platform.OS === "ios" && editPicker && <Chip label="Done" on={false} onPress={() => setEditPicker(null)} />}
            <View style={[s.row, { marginTop: spacing.md }]}>
              <View style={{ flex: 1 }}><Btn label="Save changes" onPress={() => {
                if (!editingSessionId) return;
                const date = localDateString(sessionDate), time = formatTime(sessionTime), start = timeMinutes(time);
                const session = data.sessions.find((item) => item.id === editingSessionId);
                if (!session) return Alert.alert("Session not found", "Refresh the planner and try again.");
                if (date < dateStr() || (date === dateStr() && start <= new Date().getHours() * 60 + new Date().getMinutes())) return Alert.alert("Choose a future time", "A planned session must be scheduled for a future time.");
                if (start + session.minutes > 24 * 60) return Alert.alert("Time range", "This session would run past midnight. Choose an earlier start time.");
                if (hasSessionConflict(data, date, time, session.minutes, editingSessionId)) return Alert.alert("Time conflict", "Another planned session already overlaps this time. Choose a different time.");
                rescheduleSession(editingSessionId, date, time); setEditingSessionId(null); setEditPicker(null);
              }} /></View>
              <View style={{ flex: 1 }}><Btn ghost label="Cancel" onPress={() => { setEditingSessionId(null); setEditPicker(null); }} /></View>
            </View>
          </Card>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
