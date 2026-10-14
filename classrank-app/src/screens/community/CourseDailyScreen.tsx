import React, { useCallback, useEffect, useState } from "react";
import { View, Text } from "react-native";
import { colors, spacing, type } from "../../theme/tokens";
import PressableScale from "../../components/animated/PressableScale";
import { Back, Bar, Btn, Card, Empty, Muted, Tag, s, ListSkeleton } from "../../components/study/ui";
import { Screen } from "../../components/responsive";
import { fetchDailyQuiz, answerDaily, DailyQuiz, DailyAnswerResult } from "../../lib/courseApi";

const LETTERS = ["A", "B", "C", "D"];

/**
 * The course's daily quiz. Questions are chosen by the server from topics the student has started reading, graded on
 * the server, and only the first answer to each question counts. After every answer the AI guide is one tap away.
 */
export default function CourseDailyScreen({ navigation, route }: any) {
  const { courseId, code } = route.params as { courseId: string; code?: string };
  const [quiz, setQuiz] = useState<DailyQuiz | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [res, setRes] = useState<DailyAnswerResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [score, setScore] = useState({ right: 0, points: 0, total: 0 });

  const load = useCallback(async () => {
    try { setQuiz(await fetchDailyQuiz(courseId)); setError(null); } catch (e: any) { setError(e?.message ?? "Couldn't load today's quiz."); }
  }, [courseId]);
  useEffect(() => { load(); }, [load]);

  if (error) return <Screen><Back onPress={() => navigation.goBack()} /><Text style={s.h1}>Daily quiz</Text><Muted style={{ marginTop: 8 }}>{error}</Muted><Btn label="Try again" onPress={load} /></Screen>;
  if (!quiz) return <Screen><Back onPress={() => navigation.goBack()} /><ListSkeleton /></Screen>;

  const qs = quiz.questions;
  const q = qs[i];
  const finished = i >= qs.length;

  const choose = async (k: number) => {
    if (res || busy || !q) return;
    setPicked(k); setBusy(true);
    try {
      const r = await answerDaily(q.id, k);
      setRes(r);
      setScore((x) => ({ right: x.right + (r.is_correct ? 1 : 0), points: x.points + r.points_earned, total: x.total + 1 }));
    } catch (e: any) { setPicked(null); setError(e?.message ?? "Couldn't submit your answer."); } finally { setBusy(false); }
  };
  const next = () => { setI(i + 1); setPicked(null); setRes(null); };
  const askAi = () => q && navigation.navigate("Companion", {
    prompt: `Help me understand this ${code ?? "course"} question${q.topic ? ` (topic: ${q.topic})` : ""}: "${q.question}" Options: ${q.options.map((o, k) => `${LETTERS[k]}) ${o}`).join("; ")}. I chose ${LETTERS[picked ?? 0]}${res ? (res.is_correct ? " and it was right" : " and it was wrong") : ""}. Explain the idea behind it step by step.`,
  });

  if (qs.length === 0 || finished) {
    const why = quiz.answered_today >= quiz.daily_limit || finished ? "That's everything for today. Come back tomorrow for more."
      : quiz.pending_total > 0 ? "There are questions waiting, but they unlock as you open the resources in each topic. Go read a topic, then come back."
      : "Your teacher hasn't added daily questions for this course yet.";
    return (
      <Screen>
        <Back onPress={() => navigation.goBack()} />
        <Text style={s.h1}>Daily quiz</Text>
        {finished && score.total > 0 ? (
          <Card style={{ marginTop: spacing.lg }}>
            <Text style={[s.h1, { color: score.right / score.total >= 0.5 ? colors.success : colors.ember }]}>{score.right} / {score.total}</Text>
            <Muted>{score.points > 0 ? `+${score.points} leaderboard points. ` : ""}Only your first answer to each question counts.</Muted>
          </Card>
        ) : null}
        <Empty icon={finished ? "🎉" : "📘"} title={finished ? "Nice work" : "No questions right now"} body={why} />
        <Btn label="Back to the course" onPress={() => navigation.goBack()} />
        {score.total > 0 && score.right < score.total && <Btn ghost label="🤖 Ask the AI guide about what I missed" onPress={() => navigation.navigate("Companion", { prompt: `I just did the ${code ?? "course"} daily quiz and got ${score.total - score.right} wrong. Help me revise the topics I'm weakest in.` })} />}
      </Screen>
    );
  }

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
        {q.options.map((o, k) => {
          const isPicked = picked === k, isRight = res && k === res.correct_index, isWrong = res && isPicked && !res.is_correct;
          const border = isRight ? colors.success : isWrong ? colors.danger : isPicked ? colors.teal : colors.border;
          const bg = isRight ? colors.successTint : isWrong ? colors.dangerTint : isPicked ? colors.tealTint : colors.card;
          return (
            <PressableScale key={k} onPress={() => choose(k)} disabled={!!res || busy}>
              <View style={{ marginTop: spacing.sm, padding: spacing.md, borderRadius: 12, borderWidth: 1.5, borderColor: border, backgroundColor: bg }}>
                <Text style={type.body}>{LETTERS[k]}) {o}{isRight ? "  ✓" : isWrong ? "  ✗" : ""}</Text>
              </View>
            </PressableScale>
          );
        })}
      </Card>

      {res && (
        <Card style={{ borderColor: res.is_correct ? colors.success : colors.danger }}>
          <Text style={[s.h3, { color: res.is_correct ? colors.success : colors.danger }]}>{res.already_answered ? "You already answered this one" : res.is_correct ? `Correct! +${res.points_earned} pts` : "Not quite"}</Text>
          {!!res.explanation && <Text style={[type.body, { color: colors.text, marginTop: 4 }]}>{res.explanation}</Text>}
          {!res.is_correct && !res.explanation && <Muted>The right answer was {LETTERS[res.correct_index]}.</Muted>}
          <Btn ghost label={res.is_correct ? "🤖 Go deeper with the AI guide" : "🤖 Explain this with the AI guide"} onPress={askAi} />
        </Card>
      )}
      {res && <Btn label={i === qs.length - 1 ? "Finish" : "Next question"} onPress={next} />}
    </Screen>
  );
}
