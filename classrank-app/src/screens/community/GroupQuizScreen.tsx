import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { colors, spacing, type } from "../../theme/tokens";
import { useApp } from "../../context/AppContext";
import PressableScale from "../../components/animated/PressableScale";
import PulseRing from "../../components/animated/PulseRing";
import AnimatedNumber from "../../components/animated/AnimatedNumber";
import ConfettiBurst from "../../components/animated/ConfettiBurst";
import StaggerIn from "../../components/animated/StaggerIn";
import Reveal from "../../components/animated/Reveal";
import { Back, Bar, Btn, Card, Label, ListSkeleton, Muted, s } from "../../components/study/ui";
import { fetchGroupQuiz, startGroupQuiz, saveGroupQuizAnswer, finalizeGroupQuiz, submitGroupQuiz, fetchQuizReview, fetchQuizStandings, GroupQuizPlay, GroupQuizReviewItem, QuizStanding } from "../../lib/groupApi";
import { WRAP } from "../../components/responsive";

const LETTERS = ["A", "B", "C", "D"];
const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

/**
 * Take a group quiz (exam-style: no feedback until you submit), then see your score, the group ranking,
 * and the answers + explanations. Grading happens on the server, so the answers are never on the device
 * until you've submitted.
 */
export default function GroupQuizScreen({ navigation, route }: any) {
  const { quizId } = route.params as { quizId: string };
  const { profile } = useApp();
  const [quiz, setQuiz] = useState<GroupQuizPlay | null>(null);
  const [picks, setPicks] = useState<(number | null)[]>([]);
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<"loading" | "confirm" | "play" | "done">("loading");
  const [score, setScore] = useState<{ correct: number; total: number } | null>(null);
  const [standings, setStandings] = useState<QuizStanding[]>([]);
  const [review, setReview] = useState<GroupQuizReviewItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savingPick, setSavingPick] = useState(false);
  const [alreadyTaken, setAlreadyTaken] = useState(false);
  const [shown, setShown] = useState(0);
  const [fire, setFire] = useState(false);
  const started = useRef(Date.now());
  const allowLeave = useRef(false);

  const showResults = useCallback(async (sc?: { correct: number; total: number }) => {
    const [st, rv] = await Promise.all([fetchQuizStandings(quizId), fetchQuizReview(quizId)]);
    setStandings(st); setReview(rv);
    const mine = sc ?? st.find((x) => x.profile_id === profile?.id);
    if (mine) setScore({ correct: mine.correct, total: mine.total });
    setPhase("done");
  }, [quizId, profile?.id]);

  const begin = useCallback(async () => {
    if (!quiz || busy) return;
    setBusy(true);
    try {
      const attempt = await startGroupQuiz(quizId);
      setQuiz((current) => current ? { ...current, questions: attempt.questions, taken: false } : current);
      setPicks(attempt.questions.map(() => null));
      started.current = Date.now();
      setPhase("play");
    } catch (e: any) {
      try {
        const latest = await fetchGroupQuiz(quizId);
        setQuiz(latest);
        if (latest.taken) { setAlreadyTaken(true); setPicks(latest.my_answers ?? []); await showResults(latest.result ?? undefined); }
        else { Alert.alert("Couldn't start the quiz", e?.message ?? "Please try again."); }
      } catch (refreshError: any) { Alert.alert("Couldn't start the quiz", refreshError?.message ?? e?.message ?? "Please try again."); }
    } finally { setBusy(false); }
  }, [quiz, busy, quizId, showResults]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const q = await fetchGroupQuiz(quizId);
        if (!active) return;
        setQuiz(q);
        if (q.taken) { setAlreadyTaken(true); setPicks(q.my_answers ?? []); await showResults(q.result ?? undefined); }
        else setPhase("confirm");
      } catch (e: any) { if (active) setError(e?.message ?? "Couldn't load this quiz."); }
    })();
    return () => { active = false; };
  }, [quizId, showResults]);

  const leave = useCallback(() => {
    if (phase !== "play") { navigation.goBack(); return; }
    if (busy || savingPick) { Alert.alert("Saving your answer", "Wait for the selected answer to finish saving, then leave the quiz."); return; }
    Alert.alert(
      "Leave quiz?",
      "Your attempt has already started. Steth will score the answers saved so far and count unanswered questions as wrong. You cannot restart this quiz.",
      [
        { text: "Keep going", style: "cancel" },
        { text: "Leave and finish", style: "destructive", onPress: async () => {
          setBusy(true);
          try { await finalizeGroupQuiz(quizId); allowLeave.current = true; navigation.goBack(); }
          catch (e: any) { Alert.alert("Couldn't finish the attempt", e?.message ?? "Your quiz is still open. Please try again."); }
          finally { setBusy(false); }
        } },
      ],
    );
  }, [phase, busy, savingPick, quizId, navigation]);

  useEffect(() => {
    if (phase !== "play") return;
    return navigation.addListener("beforeRemove", (event: any) => {
      if (allowLeave.current) return;
      event.preventDefault();
      leave();
    });
  }, [navigation, phase, leave]);

  // Score "earns" itself on the results screen, with confetti for a strong result.
  useEffect(() => {
    if (phase !== "done" || !score) return;
    const pct = Math.round((score.correct / score.total) * 100);
    const t1 = setTimeout(() => setShown(pct), 250);
    const t2 = setTimeout(() => setFire(pct >= 80), 700);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [phase, score]);

  const submit = () => {
    if (!quiz || busy) return;
    const unanswered = picks.filter((p) => p === null).length;
    Alert.alert("Submit quiz?", unanswered ? `${unanswered} unanswered will count as wrong. You can only take this once.` : "You can only take this once.", [
      { text: "Review", style: "cancel" },
      { text: "Submit", onPress: async () => {
        setBusy(true);
        try {
          const sc = await submitGroupQuiz(quizId, picks, Math.round((Date.now() - started.current) / 1000));
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          await showResults(sc);
        } catch (e: any) { Alert.alert("Couldn't submit", e?.message ?? "Try again."); } finally { setBusy(false); }
      } },
    ]);
  };

  if (error) return <SafeAreaView style={s.safe}><View style={{ padding: spacing.xl }}><Back onPress={() => navigation.goBack()} /><Text style={s.h1}>Quiz unavailable</Text><Muted style={{ marginTop: 8 }}>{error}</Muted></View></SafeAreaView>;
  if (phase === "loading" || !quiz) return <SafeAreaView style={s.safe}><View style={{ padding: spacing.xl }}><Back onPress={() => navigation.goBack()} /><ListSkeleton rows={4} /></View></SafeAreaView>;
  if (phase === "confirm") return (
    <SafeAreaView style={s.safe}>
      <View style={{ ...WRAP, flex: 1, width: "100%", padding: spacing.xl, justifyContent: "center" }}>
        <Back onPress={() => navigation.goBack()} label="← Back to group" />
        <Card style={{ marginTop: spacing.lg, padding: spacing.xl, borderColor: colors.teal }}>
          <Label>BEFORE YOU BEGIN</Label>
          <Text style={[s.h1, { marginTop: spacing.sm }]}>{quiz.title}</Text>
          <Muted style={{ marginTop: spacing.sm }}>Are you ready to take this group quiz?</Muted>
          <View style={{ marginTop: spacing.md, gap: spacing.xs }}>
            <Muted>• You can take this quiz only once.</Muted>
            <Muted>• Your answers are saved as you choose them.</Muted>
            <Muted>• If you leave after starting, saved answers will be scored and unanswered questions will count as wrong.</Muted>
          </View>
          <View style={{ marginTop: spacing.lg }}>
            <Btn label={busy ? "Starting quiz…" : "Yes, start quiz"} disabled={busy} onPress={() => { void begin(); }} />
            <View style={{ marginTop: spacing.sm }}><Btn label="Not now" ghost disabled={busy} onPress={() => navigation.goBack()} /></View>
          </View>
        </Card>
      </View>
    </SafeAreaView>
  );

  if (phase === "done" && score) {
    const pct = Math.round((score.correct / score.total) * 100);
    const tone = pct >= 80 ? colors.success : pct >= 60 ? colors.ember : colors.danger;
    const mineRank = standings.findIndex((x) => x.profile_id === profile?.id) + 1;
    const myPicks = picks;
    return (
      <SafeAreaView style={s.safe}>
        <ScrollView contentContainerStyle={{ ...WRAP, padding: spacing.xl, paddingBottom: spacing.xxxl * 2 }}>
          <Back onPress={() => navigation.goBack()} label="← Back to group" />
          <Text style={s.h2}>{quiz.title}</Text>
          {alreadyTaken && <Card style={{ marginTop: spacing.md, borderColor: colors.danger }}><Text style={[s.h3, { color: colors.danger }]}>You already took this quiz</Text><Muted>Your saved answers have been scored. Any question left unanswered when you exited counted as wrong.</Muted></Card>}
          <View style={{ alignItems: "center", marginVertical: spacing.lg }}>
            <PulseRing size={160} strokeWidth={12} progress={shown / 100} color={tone} trackColor={colors.border} pulse={false}>
              <AnimatedNumber value={shown} suffix="%" duration={900} style={[type.hero, { color: tone }]} />
            </PulseRing>
            <ConfettiBurst active={fire} />
            <Text style={[s.h3, { marginTop: spacing.md }]}>{score.correct} of {score.total} correct{mineRank ? ` · #${mineRank} in your group` : ""}</Text>
          </View>

          <Label>RANKING</Label>
          {standings.map((x, i) => (
            <StaggerIn key={x.profile_id} index={i}>
              <Card style={{ flexDirection: "row", justifyContent: "space-between", backgroundColor: x.profile_id === profile?.id ? colors.tealTint : colors.card }}>
                <Text style={type.bodyMedium}>{i + 1}. {x.name}{x.profile_id === profile?.id ? " (you)" : ""}</Text>
                <Muted>{x.correct}/{x.total} · {fmt(x.seconds)}</Muted>
              </Card>
            </StaggerIn>
          ))}

          {review.length > 0 && <Label>ANSWERS</Label>}
          {review.map((r, i) => {
            const mine = myPicks[i]; // only known if you took it in this session
            return (
              <Reveal key={i} delay={Math.min(i * 40, 400)}>
                <Card>
                  <Text style={s.h3}>{i + 1}. {r.q}</Text>
                  {mine !== undefined && mine !== null && <Muted style={{ marginTop: 6 }}>You chose: {LETTERS[mine]}. {r.options[mine]}</Muted>}
                  <Text style={[type.bodyMedium, { color: colors.success, marginTop: 2 }]}>Answer: {LETTERS[r.correct]}. {r.options[r.correct]}</Text>
                  {!!r.explanation && <Text style={[type.body, { color: colors.textMuted, marginTop: 6 }]}>{r.explanation}</Text>}
                </Card>
              </Reveal>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    );
  }

  const q = quiz.questions[idx];
  const answered = picks.filter((p) => p !== null).length;
  const last = idx === quiz.questions.length - 1;
  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={{ ...WRAP, padding: spacing.xl, paddingBottom: spacing.xxxl * 2 }}>
        <Back onPress={leave} label="← Exit" />
        <Text style={s.h3}>{quiz.title}</Text>
        <Muted>Question {idx + 1} of {quiz.questions.length} · {answered} answered</Muted>
        <View style={{ marginTop: spacing.sm }}><Bar value={(idx + 1) / quiz.questions.length} /></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.md }}>
          {quiz.questions.map((_, i) => (
            <PressableScale key={i} onPress={() => setIdx(i)} style={{ width: 34, height: 34, borderRadius: 17, marginRight: 6, alignItems: "center", justifyContent: "center", backgroundColor: i === idx ? colors.teal : picks[i] !== null ? colors.textFaint : colors.border }}>
              <Text style={[type.label, { color: i === idx || picks[i] !== null ? "#fff" : colors.text }]}>{i + 1}</Text>
            </PressableScale>
          ))}
        </ScrollView>

        <Reveal key={idx}>
          <Text style={[type.h2, { color: colors.text, marginTop: spacing.xl, marginBottom: spacing.lg }]}>{q.q}</Text>
          {q.options.map((o, i) => {
            const on = picks[idx] === i;
            return (
              <PressableScale key={i} disabled={busy || savingPick} onPress={async () => {
                if (savingPick || busy) return;
                setSavingPick(true);
                try { await saveGroupQuizAnswer(quizId, idx, i); Haptics.selectionAsync().catch(() => {}); setPicks((p) => p.map((v, k) => (k === idx ? i : v))); }
                catch (e: any) { Alert.alert("Couldn't save your answer", e?.message ?? "Check your connection and try again."); }
                finally { setSavingPick(false); }
              }}
                style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: on ? colors.tealTint : colors.card, borderWidth: 1.5, borderColor: on ? colors.teal : colors.border, borderRadius: 14, padding: spacing.lg, marginBottom: spacing.sm, opacity: busy || savingPick ? 0.65 : 1 }}>
                <Text style={[s.h3, { color: colors.textMuted, width: 22 }]}>{LETTERS[i]}</Text>
                <Text style={[type.body, { color: colors.text, flex: 1 }]}>{o}</Text>
              </PressableScale>
            );
          })}
        </Reveal>

        <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg }}>
          {idx > 0 && <View style={{ flex: 1 }}><Btn ghost label="Previous" onPress={() => setIdx(idx - 1)} /></View>}
          <View style={{ flex: 1 }}>
            {last ? <Btn label={busy ? "Submitting…" : `Submit (${answered}/${quiz.questions.length})`} disabled={busy || savingPick} onPress={submit} /> : <Btn label={savingPick ? "Saving…" : "Next"} disabled={savingPick} onPress={() => setIdx(idx + 1)} />}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
