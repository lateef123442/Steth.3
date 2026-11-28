import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Alert } from "react-native";
import { colors, spacing, type } from "../../theme/tokens";
import PressableScale from "../../components/animated/PressableScale";
import { Back, Bar, Btn, Card, Empty, Muted, Tag, s, ListSkeleton } from "../../components/study/ui";
import { Screen } from "../../components/responsive";
import {
  fetchDailyQuiz, startDailyQuiz, answerDaily,
  type DailyQuizAttempt, type DailyQuizStatus, type DailyAnswerResult,
} from "../../lib/courseApi";

const LETTERS = ["A", "B", "C", "D"];
type Phase = "loading" | "error" | "confirm" | "starting" | "playing" | "locked" | "empty" | "done";

/** Daily course quiz: questions are fetched only after explicit confirmation. Starting reserves the day's one attempt. */
export default function CourseDailyScreen({ navigation, route }: any) {
  const { courseId, code } = route.params as { courseId: string; code?: string };
  const [phase, setPhase] = useState<Phase>("loading");
  const [status, setStatus] = useState<DailyQuizStatus | null>(null);
  const [attempt, setAttempt] = useState<DailyQuizAttempt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [res, setRes] = useState<DailyAnswerResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [score, setScore] = useState({ right: 0, points: 0, total: 0 });
  const allowRemoval = useRef(false);

  const loadStatus = useCallback(async () => {
    setPhase("loading");
    setError(null);
    try {
      const next = await fetchDailyQuiz(courseId);
      setStatus(next);
      if (next.started_today) setPhase("locked");
      else if (next.available_questions > 0) setPhase("confirm");
      else setPhase("empty");
    } catch (e: any) {
      setError(e?.message ?? "Couldn't check today's quiz.");
      setPhase("error");
    }
  }, [courseId]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  // Hardware/back gestures are also covered: once started, leaving consumes the attempt permanently for today.
  useEffect(() => navigation.addListener("beforeRemove", (event: any) => {
    if ((phase !== "playing" && phase !== "starting") || allowRemoval.current) return;
    event.preventDefault();
    Alert.alert(
      "Leave this quiz?",
      "Your attempt has already started. If you leave now, unanswered questions will be forfeited and you cannot reopen this quiz today.",
      [
        { text: "Keep taking quiz", style: "cancel" },
        { text: "Leave quiz", style: "destructive", onPress: () => { allowRemoval.current = true; navigation.dispatch(event.data.action); } },
      ],
    );
  }), [navigation, phase]);

  const begin = async () => {
    if (busy) return;
    setBusy(true);
    setPhase("starting");
    setError(null);
    try {
      const started = await startDailyQuiz(courseId);
      if (started.already_started) {
        const next = await fetchDailyQuiz(courseId);
        setStatus(next);
        setPhase("locked");
        return;
      }
      if (!started.questions?.length) {
        const next = await fetchDailyQuiz(courseId);
        setStatus(next);
        setPhase("empty");
        return;
      }
      setAttempt(started);
      setI(0);
      setPicked(null);
      setRes(null);
      setScore({ right: 0, points: 0, total: 0 });
      setPhase("playing");
    } catch (e: any) {
      // A lost network response may happen after the server reserved the attempt. Re-check before offering retry.
      try {
        const next = await fetchDailyQuiz(courseId);
        setStatus(next);
        if (next.started_today) {
          setPhase("locked");
          setError("The attempt was reserved, but the questions could not be loaded on this device. It cannot be restarted today.");
        } else {
          setPhase("confirm");
          setError(e?.message ?? "Couldn't start the quiz. Please try again.");
        }
      } catch {
        setPhase("confirm");
        setError(e?.message ?? "Couldn't start the quiz. Check your connection and try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  if (phase === "loading") return <Screen><Back onPress={() => navigation.goBack()} /><ListSkeleton rows={3} /></Screen>;
  if (phase === "error") return <Screen><Back onPress={() => navigation.goBack()} /><Text style={s.h1}>Daily quiz</Text><Muted style={{ marginTop: 8 }}>{error}</Muted><Btn label="Try again" onPress={loadStatus} /></Screen>;

  if (phase === "confirm" || phase === "starting") return (
    <Screen>
      <Back onPress={() => navigation.goBack()} />
      <Text style={s.h1}>{code ?? "Course"} daily quiz</Text>
      <Card style={{ marginTop: spacing.lg, borderColor: colors.teal }}>
        <Tag label="BEFORE YOU BEGIN" color={colors.teal} />
        <Text style={[s.h2, { marginTop: spacing.sm }]}>Are you ready to take this quiz?</Text>
        <Muted style={{ marginTop: spacing.sm }}>You have {status?.available_questions ?? 0} question(s) available in this attempt.</Muted>
        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          <Muted>• You can take this course's daily quiz only once per day.</Muted>
          <Muted>• Your attempt begins only when you press “Yes, start quiz”.</Muted>
          <Muted>• If you close or leave after starting, you cannot reopen it today. Unanswered questions are forfeited.</Muted>
          <Muted>• Choose “Not now” to leave without using your attempt.</Muted>
        </View>
        {!!error && <Muted style={{ marginTop: spacing.md, color: colors.danger }}>{error}</Muted>}
        <View style={{ marginTop: spacing.lg }}>
          <Btn label={phase === "starting" ? "Starting quiz…" : "Yes, start quiz"} disabled={phase === "starting" || busy} onPress={begin} />
          <View style={{ marginTop: spacing.sm }}><Btn ghost label="Not now" disabled={phase === "starting" || busy} onPress={() => navigation.goBack()} /></View>
        </View>
      </Card>
    </Screen>
  );

  if (phase === "locked") return (
    <Screen>
      <Back onPress={() => navigation.goBack()} />
      <Text style={s.h1}>{code ?? "Course"} daily quiz</Text>
      <Card style={{ marginTop: spacing.lg, borderColor: colors.ember }}>
        <Text style={s.h2}>{status?.completed_today ? "Today's quiz is completed" : "Today's attempt has already started"}</Text>
        <Muted style={{ marginTop: spacing.sm }}>{status?.completed_today ? "You have already used today's attempt for this course." : "This quiz was already started. Forfeited or unanswered questions cannot be reopened or retaken today."} A new daily attempt will be available tomorrow.</Muted>
        {!!error && <Muted style={{ color: colors.danger, marginTop: spacing.sm }}>{error}</Muted>}
      </Card>
      <Btn label="Back to quizzes" onPress={() => navigation.goBack()} />
    </Screen>
  );

  if (phase === "empty") {
    const why = (status?.answered_today ?? 0) >= (status?.daily_limit ?? 5)
      ? "That's everything for today. Come back tomorrow for a new attempt."
      : (status?.pending_total ?? 0) > 0
        ? "There are questions waiting, but they unlock as you open the resources in each topic. Go read a topic, then come back."
        : "Your teacher hasn't added daily questions for this course yet.";
    return <Screen><Back onPress={() => navigation.goBack()} /><Text style={s.h1}>Daily quiz</Text><Empty icon="📘" title="No questions right now" body={why} /><Btn label="Back to the course" onPress={() => navigation.goBack()} /></Screen>;
  }

  if (phase === "done") return (
    <Screen>
      <Back onPress={() => navigation.goBack()} />
      <Text style={s.h1}>Daily quiz complete</Text>
      <Card style={{ marginTop: spacing.lg }}>
        <Text style={[s.h1, { color: score.total > 0 && score.right / score.total >= 0.5 ? colors.success : colors.ember }]}>{score.right} / {score.total}</Text>
        <Muted>{score.points > 0 ? `+${score.points} leaderboard points. ` : ""}Your one attempt for today has been used.</Muted>
      </Card>
      <Btn label="Back to quizzes" onPress={() => navigation.goBack()} />
      {score.total > 0 && score.right < score.total && <Btn ghost label="Ask the AI guide about what I missed" onPress={() => navigation.navigate("Companion", { prompt: `I just did the ${code ?? "course"} daily quiz and got ${score.total - score.right} wrong. Help me revise the topics I'm weakest in.` })} />}
    </Screen>
  );

  const qs = attempt?.questions ?? [];
  const q = qs[i];
  if (!q) return <Screen><Back onPress={() => navigation.goBack()} /><Muted>Loading your quiz…</Muted></Screen>;

  const choose = async (k: number) => {
    if (res || busy || !q) return;
    setPicked(k);
    setBusy(true);
    try {
      const result = await answerDaily(q.id, k);
      setRes(result);
      setScore((x) => ({ right: x.right + (result.is_correct ? 1 : 0), points: x.points + result.points_earned, total: x.total + 1 }));
    } catch (e: any) {
      setPicked(null);
      Alert.alert("Couldn't submit your answer", e?.message ?? "Check your connection and try again.");
    } finally { setBusy(false); }
  };
  const next = () => {
    if (i === qs.length - 1) setPhase("done");
    else { setI(i + 1); setPicked(null); setRes(null); }
  };
  const askAi = () => navigation.navigate("Companion", {
    prompt: `Help me understand this ${code ?? "course"} question${q.topic ? ` (topic: ${q.topic})` : ""}: "${q.question}" Options: ${q.options.map((o, k) => `${LETTERS[k]}) ${o}`).join("; ")}. I chose ${LETTERS[picked ?? 0]}${res ? (res.is_correct ? " and it was right" : " and it was wrong") : ""}. Explain the idea behind it step by step.`,
  });

  return (
    <Screen>
      <Back onPress={() => navigation.goBack()} label="← Leave" />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={s.h1}>Daily quiz</Text>
        <Tag label={`${i + 1} / ${qs.length}`} color={colors.violet} />
      </View>
      <View style={{ marginTop: spacing.sm }}><Bar value={(i + (res ? 1 : 0)) / qs.length} /></View>
      <Card style={{ marginTop: spacing.lg }}>
        {!!q.topic && <Muted>{q.topic}</Muted>}
        <Text style={[s.h3, { marginTop: 2 }]}>{q.question}</Text>
        {q.options.map((option, k) => {
          const isPicked = picked === k, isRight = !!res && k === res.correct_index, isWrong = !!res && isPicked && !res.is_correct;
          const border = isRight ? colors.success : isWrong ? colors.danger : isPicked ? colors.teal : colors.border;
          const bg = isRight ? colors.successTint : isWrong ? colors.dangerTint : isPicked ? colors.tealTint : colors.card;
          return <PressableScale key={k} onPress={() => choose(k)} disabled={!!res || busy}>
            <View style={{ marginTop: spacing.sm, padding: spacing.md, borderRadius: 12, borderWidth: 1.5, borderColor: border, backgroundColor: bg }}>
              <Text style={type.body}>{LETTERS[k]}) {option}{isRight ? "  ✓" : isWrong ? "  ✗" : ""}</Text>
            </View>
          </PressableScale>;
        })}
      </Card>
      {res && <Card style={{ borderColor: res.is_correct ? colors.success : colors.danger }}>
        <Text style={[s.h3, { color: res.is_correct ? colors.success : colors.danger }]}>{res.already_answered ? "You already answered this one" : res.is_correct ? `Correct! +${res.points_earned} pts` : "Not quite"}</Text>
        {!!res.explanation && <Text style={[type.body, { color: colors.text, marginTop: 4 }]}>{res.explanation}</Text>}
        {!res.is_correct && !res.explanation && <Muted>The right answer was {LETTERS[res.correct_index]}.</Muted>}
        <Btn ghost label={res.is_correct ? "Go deeper with the AI guide" : "Explain this with the AI guide"} onPress={askAi} />
      </Card>}
      {res && <Btn label={i === qs.length - 1 ? "Finish" : "Next question"} disabled={busy} onPress={next} />}
    </Screen>
  );
}
