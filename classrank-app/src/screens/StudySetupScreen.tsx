import React, { useEffect, useState } from "react";
import Notifications from "../lib/expoNotifications";
import { View, Text, ScrollView, TextInput, Switch, Alert, Platform } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing } from "../theme/tokens";
import { useApp } from "../context/AppContext";
import { Back, Btn, Card, Chip, Label, Muted, s } from "../components/study/ui";
import { useStudy, setPrefs, isTime, fmtTime12 } from "../lib/studyStore";
import { requestNotificationPermissions, registerPushToken, clearPushToken } from "../lib/notifications";
import { useSyncStatus } from "../hooks/useStudyCloudSync";
import { syncNow } from "../lib/studySync";
import { WRAP } from "../components/responsive";

const GOALS = ["Pass exams", "Improve grades", "Prepare for an exam", "Master a subject", "Study consistently"];
const TIMES = ["07:00", "12:00", "17:00", "20:00", "22:00"];
const MINS = [30, 45, 60, 90, 120];
const TYPES: { key: "sessions" | "missed" | "dailyQuiz" | "reviews" | "push"; title: string; sub: string }[] = [
  { key: "sessions", title: "Session reminders", sub: "10 minutes before a planned session" },
  { key: "missed", title: "Missed-session nudges", sub: "Offer to reschedule if you skipped one" },
  { key: "dailyQuiz", title: "Daily challenge", sub: "A gentle prompt before your study time" },
  { key: "reviews", title: "Review prompts", sub: "When a topic or flashcards are due" },
  { key: "push", title: "Class announcements & replies", sub: "Alerts from your courses and study groups. Can't be silenced by quiet hours." },
];

export default function StudySetupScreen({ navigation }: any) {
  const { profile } = useApp();
  const { data } = useStudy();
  const p = data.prefs;
  const sync = useSyncStatus();
  const [allowed, setAllowed] = useState(true);
  useEffect(() => { Notifications.getPermissionsAsync().then((r) => setAllowed(r.status === "granted")).catch(() => {}); }, []);
  const [qs, setQs] = useState(p.quietStart), [qe, setQe] = useState(p.quietEnd), [custom, setCustom] = useState("");
  const [customDaily, setCustomDaily] = useState(String(p.dailyMinutes));
  const [timePicker, setTimePicker] = useState<"preferred" | "quietStart" | "quietEnd" | null>(null);
  const asTimeDate = (value: string) => { const [h, m] = value.split(":").map(Number); const d = new Date(); d.setHours(h || 0, m || 0, 0, 0); return d; };
  const pickedTime = (value: Date) => `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;

  const toggleGoal = (g: string) => setPrefs({ goals: p.goals.includes(g) ? p.goals.filter((x) => x !== g) : [...p.goals, g], setupDone: true });
  const toggleNotif = async (k: (typeof TYPES)[number]["key"], v: boolean) => {
    if (v && !(await requestNotificationPermissions())) return Alert.alert("Notifications are off", "Enable notifications for Steth in your phone settings to get reminders.");
    setPrefs({ notif: { ...p.notif, [k]: v } });
    if (k === "push") { if (v && profile?.id) registerPushToken(profile.id); else clearPushToken(profile?.id); }
  };
  const saveQuiet = () => setPrefs({ quietStart: qs, quietEnd: qe });
  const saveCustom = () => { if (!isTime(custom)) return Alert.alert("Time", "Choose a valid time."); setPrefs({ preferredTime: custom, setupDone: true }); setCustom(""); };
  const saveDailyMinutes = () => {
    const value = Number(customDaily);
    if (!Number.isInteger(value) || value < 1 || value > 1440) return Alert.alert("Study duration", "Enter a whole number from 1 to 1440 minutes.");
    setPrefs({ dailyMinutes: value, setupDone: true });
  };

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={{ ...WRAP, padding: spacing.xl, paddingBottom: spacing.xxxl * 2 }} keyboardShouldPersistTaps="handled">
        <Back onPress={() => navigation.goBack()} />
        <Text style={s.h1}>Study setup</Text>
        <Muted style={{ marginTop: 4 }}>This is how I personalise your plan and reminders.</Muted>

        <Card style={{ marginTop: spacing.lg }}>
          <Text style={s.h3}>{profile?.name}</Text>
          <Muted>{[profile?.university, profile?.department, profile?.year ? `Year ${profile.year}` : null].filter(Boolean).join(" · ")}</Muted>
        </Card>

        <Label>WHAT ARE YOU WORKING TOWARD?</Label>
        <View style={s.row}>{GOALS.map((g) => <Chip key={g} label={g} on={p.goals.includes(g)} onPress={() => toggleGoal(g)} />)}</View>

        <Label>WHEN DO YOU LIKE TO STUDY?</Label>
        <View style={s.row}>{TIMES.map((t) => <Chip key={t} label={fmtTime12(t)} on={p.preferredTime === t} onPress={() => setPrefs({ preferredTime: t, setupDone: true })} />)}</View>
        <Btn ghost label={`Choose any time · ${fmtTime12(p.preferredTime)}`} onPress={() => setTimePicker("preferred")} />
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <TextInput style={[s.input, { flex: 1 }]} value={custom} onChangeText={setCustom} placeholder="Or enter HH:MM" placeholderTextColor={colors.textFaint} keyboardType="numbers-and-punctuation" />
          <Chip label="Set" on={false} onPress={saveCustom} />
        </View>

        <Label>TIME AVAILABLE PER DAY</Label>
        <View style={s.row}>{MINS.map((m) => <Chip key={m} label={`${m} min`} on={p.dailyMinutes === m} onPress={() => { setCustomDaily(String(m)); setPrefs({ dailyMinutes: m, setupDone: true }); }} />)}</View>
        <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
          <TextInput style={[s.input, { flex: 1 }]} value={customDaily} onChangeText={setCustomDaily} placeholder="Custom minutes" placeholderTextColor={colors.textFaint} keyboardType="number-pad" />
          <Chip label="Set minutes" on={false} onPress={saveDailyMinutes} />
        </View>

        <Label>CLOUD BACKUP</Label>
        <Card>
          <Text style={s.h3}>
            {sync.state === "syncing" ? "Backing up…" : sync.state === "synced" ? "Backed up" : sync.state === "offline" ? "Waiting for a connection" : sync.state === "unavailable" ? "Not available yet" : sync.state === "error" ? "Couldn't back up" : "Ready"}
          </Text>
          <Muted style={{ marginTop: 2 }}>
            {sync.state === "unavailable" ? "Cloud backup isn't set up on this server yet, so your study data is only on this phone."
              : sync.state === "error" ? sync.message ?? "Something went wrong. It will retry."
              : sync.at ? `Last backup ${new Date(sync.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. ` : ""}
            {sync.state !== "unavailable" && sync.state !== "error" ? "Your notes, questions, quiz history and flashcards are saved to your account, so a new phone restores them. Only you can read them." : ""}
          </Muted>
          {profile?.id && sync.state !== "unavailable" && <Btn ghost label="Back up now" onPress={() => syncNow(profile.id)} disabled={sync.state === "syncing"} />}
        </Card>

        <Label>NOTIFICATIONS</Label>
        {!allowed && (
          <Card onPress={async () => setAllowed(await requestNotificationPermissions())} style={{ backgroundColor: colors.emberTint, borderWidth: 0 }}>
            <Text style={s.h3}>Reminders are switched off</Text>
            <Muted>Tap to allow notifications. If nothing appears, enable them for Steth in your phone's settings.</Muted>
          </Card>
        )}
        {TYPES.map((t) => (
          <Card key={t.key} style={{ flexDirection: "row", alignItems: "center" }}>
            <View style={{ flex: 1 }}><Text style={s.h3}>{t.title}</Text><Muted>{t.sub}</Muted></View>
            <Switch value={p.notif[t.key]} onValueChange={(v) => toggleNotif(t.key, v)} trackColor={{ true: colors.teal }} />
          </Card>
        ))}

        <Label>QUIET HOURS</Label>
        <Muted>No study notifications during this window.</Muted>
        <View style={s.row}>
          <Chip label={`Starts · ${fmtTime12(qs)}`} on={false} onPress={() => setTimePicker("quietStart")} />
          <Chip label={`Ends · ${fmtTime12(qe)}`} on={false} onPress={() => setTimePicker("quietEnd")} />
          <Chip label="Save" on={false} onPress={saveQuiet} />
        </View>
        {timePicker && <>
          <DateTimePicker value={asTimeDate(timePicker === "preferred" ? p.preferredTime : timePicker === "quietStart" ? qs : qe)} mode="time" display={Platform.OS === "ios" ? "spinner" : "default"} onChange={(event, value) => {
            if (event.type === "dismissed") { setTimePicker(null); return; }
            if (value) { const next = pickedTime(value); if (timePicker === "preferred") setPrefs({ preferredTime: next, setupDone: true }); else if (timePicker === "quietStart") setQs(next); else setQe(next); }
            if (Platform.OS !== "ios") setTimePicker(null);
          }} />
          {Platform.OS === "ios" && <Chip label="Done" on={false} onPress={() => setTimePicker(null)} />}
        </>}
      </ScrollView>
    </SafeAreaView>
  );
}
