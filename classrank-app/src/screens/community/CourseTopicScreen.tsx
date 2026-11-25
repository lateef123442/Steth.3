import React, { useCallback, useEffect, useState } from "react";
import { View, Text, Alert, Linking } from "react-native";
import { colors, spacing, type } from "../../theme/tokens";
import PressableScale from "../../components/animated/PressableScale";
import { Back, Bar, Btn, Card, Empty, Label, Muted, Tag, s, ListSkeleton } from "../../components/study/ui";
import { Screen } from "../../components/responsive";
import { fetchCourseContent, markMaterialRead, startTopicCompletionQuiz, submitTopicCompletionQuiz, materialFileUrl, TopicCompletionQuiz, TopicCompletionResult } from "../../lib/courseApi";
import { fmtSize } from "../../lib/fileRules";
import { CourseBundle } from "../../lib/studyCourseSync";
import { importCourseBundle, useStudy } from "../../lib/studyStore";

import EmojiIcon from "../../components/EmojiIcon";
const ICON = { note: "📝", link: "🔗", video: "🎬", file: "📎" } as const;

/**
 * One topic: read/open every resource, finish the topic, then practise it. Practice questions are only sent to the
 * phone after the server records the topic as finished, so there is nothing to peek at beforehand.
 */
export default function CourseTopicScreen({ navigation, route }: any) {
  const { courseId, topicId } = route.params as { courseId: string; topicId: string };
  const { data } = useStudy();
  const [bundle, setBundle] = useState<CourseBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [completionQuiz, setCompletionQuiz] = useState<TopicCompletionQuiz | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number>>({});
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizResult, setQuizResult] = useState<TopicCompletionResult | null>(null);
  const [quizBusy, setQuizBusy] = useState(false);

  const load = useCallback(async () => {
    try { const b = await fetchCourseContent(courseId); setBundle(b); importCourseBundle(b); setError(null); }
    catch (e: any) { setError(e?.message ?? "Couldn't load this topic."); }
  }, [courseId]);
  useEffect(() => { load(); }, [load]);

  if (error && !bundle) return <Screen><Back onPress={() => navigation.goBack()} /><Text style={s.h1}>Topic unavailable</Text><Muted style={{ marginTop: 8 }}>{error}</Muted><Btn label="Try again" onPress={load} /></Screen>;
  if (!bundle) return <Screen><Back onPress={() => navigation.goBack()} /><ListSkeleton /></Screen>;

  const topics = bundle.topics ?? [];
  const idx = topics.findIndex((t) => t.id === topicId);
  const topic = topics[idx];
  if (!topic) return <Screen><Back onPress={() => navigation.goBack()} /><Empty icon="🤷" title="Topic not found" body="It may have been removed by your teacher." /></Screen>;

  const prog = bundle.progress ?? { read_material_ids: [], completed_topic_ids: [], course_complete: false };
  const reads = new Set(prog.read_material_ids);
  const mats = bundle.materials.filter((m) => m.topic_id === topic.id);
  const opened = mats.filter((m) => reads.has(m.id)).length;
  const finished = prog.completed_topic_ids.includes(topic.id);
  const allOpened = opened === mats.length;
  const nextTopic = topics[idx + 1];
  const practiceQs = bundle.questions.filter((q) => q.topic_id === topic.id && (q.purpose ?? "practice") === "practice");
  const localSubject = data.subjects.find((x) => x.courseId === courseId);
  const localTopic = data.topics.find((t) => t.subjectId === localSubject?.id && t.name.toLowerCase() === topic.title.toLowerCase());

  const markRead = async (id: string) => {
    if (reads.has(id)) return;
    try { await markMaterialRead(id); setBundle((b) => b && { ...b, progress: { ...(b.progress ?? prog), read_material_ids: [...(b.progress ?? prog).read_material_ids, id] } }); }
    catch { /* offline: it will be recorded next time they open it */ }
  };
  const openResource = async (m: CourseBundle["materials"][number]) => {
    if (m.kind === "note") { setExpanded(expanded === m.id ? null : m.id); if (expanded !== m.id) markRead(m.id); return; }
    try {
      const url = m.kind === "file" ? await materialFileUrl(m.body) : m.body;
      await Linking.openURL(url);
      markRead(m.id);
    } catch (e: any) { Alert.alert("Couldn't open it", e?.message ?? "Check your connection and try again."); }
  };
  const finish = async () => {
    if (busy || finished) return;
    setBusy(true);
    try {
      const attempt = await startTopicCompletionQuiz(topic.id);
      if (attempt.questions.length !== 10) {
        throw new Error("Your teacher needs to publish 10 practice questions for this topic before you can complete it.");
      }
      setCompletionQuiz(attempt);
      setQuizAnswers({});
      setQuizIndex(0);
      setQuizResult(null);
    } catch (e: any) {
      Alert.alert("Topic check isn't ready", e?.message ?? "Your teacher needs to add 10 practice questions for this topic.");
    } finally {
      setBusy(false);
    }
  };

  const submitCompletion = async () => {
    if (!completionQuiz || quizBusy) return;
    if (completionQuiz.questions.some((q) => quizAnswers[q.id] === undefined)) {
      return Alert.alert("Answer every question", "Please answer all 10 questions before submitting.");
    }
    setQuizBusy(true);
    try {
      const result = await submitTopicCompletionQuiz(
        completionQuiz.attempt_id,
        completionQuiz.questions.map((q) => ({ question_id: q.id, picked: quizAnswers[q.id] })),
      );
      setQuizResult(result);
      if (result.passed) {
        setCompletionQuiz(null);
        setQuizResult(null);
        await load();
        Alert.alert(
          result.course_complete ? "Course completed" : "Topic completed",
          result.course_complete
            ? "You scored " + result.score + "/10. All topics are now complete, so your course tests and exams are unlocked."
            : "You scored " + result.score + "/10. Practice questions for this topic are now unlocked.",
        );
      }
    } catch (e: any) {
      Alert.alert("Couldn't submit the topic check", e?.message ?? "Please try again.");
    } finally {
      setQuizBusy(false);
    }
  };

  const retryCompletionQuiz = async () => {
    setQuizResult(null);
    setCompletionQuiz(null);
    await finish();
  };
  const askAi = (extra?: string) => navigation.navigate("Companion", { prompt: `I'm studying "${topic.title}" in ${bundle.course.code} ${bundle.course.title}. ${extra ?? "Explain the key ideas simply, then ask me a question to check I understand."}` });

  return (
    <Screen>
      <Back onPress={() => navigation.goBack()} label={`← ${bundle.course.code}`} />
      <Muted>Topic {idx + 1} of {topics.length}</Muted>
      <Text style={s.h1}>{topic.title}</Text>
      {!!topic.summary && <Text style={[type.body, { color: colors.text, marginTop: 4 }]}>{topic.summary}</Text>}

      <Card style={{ marginTop: spacing.lg }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={s.h3}>{finished ? "Topic finished" : mats.length === 0 ? "No resources in this topic yet" : `${opened} of ${mats.length} resources opened`}</Text>
          {finished && <Tag label="Done" color={colors.success} />}
        </View>
        {mats.length > 0 && <View style={{ marginTop: spacing.sm }}><Bar value={opened / mats.length} color={finished ? colors.success : colors.teal} /></View>}
      </Card>

      <Label>STUDY RESOURCES</Label>
      {mats.length === 0 && <Muted>Your teacher hasn't uploaded resources for this topic yet.</Muted>}
      {mats.map((m) => {
        const read = reads.has(m.id), isOpen = expanded === m.id;
        return (
          <Card key={m.id} onPress={() => openResource(m)}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
              <EmojiIcon emoji={ICON[m.kind]} style={{ fontSize: 22 }} />
              <View style={{ flex: 1 }}>
                <Text style={s.h3} numberOfLines={2}>{m.title}</Text>
                <Muted>{m.kind === "file" ? `${m.file_name ?? "file"}${m.file_size ? ` · ${fmtSize(m.file_size)}` : ""} · tap to open` : m.kind === "note" ? (isOpen ? "tap to collapse" : "tap to read") : "tap to open"}</Muted>
              </View>
              {read && <Tag label="Opened" color={colors.success} />}
            </View>
            {m.kind === "note" && isOpen && <Text style={[type.body, { color: colors.text, marginTop: spacing.md, lineHeight: 22 }]} selectable>{m.body}</Text>}
          </Card>
        );
      })}

      {!finished && !completionQuiz && (
        <>
          <Btn label={busy ? "Preparing questions…" : "I've finished this topic"} onPress={finish} disabled={busy || !allOpened} />
          {!allOpened
            ? <Muted style={{ textAlign: "center" }}>Open every resource above first ({mats.length - opened} left).</Muted>
            : <Muted style={{ textAlign: "center" }}>Next, answer 10 questions from this topic. You need at least 7/10 to complete it. You can retry if needed.</Muted>}
        </>
      )}

      {completionQuiz && (
        <Card style={{ marginTop: spacing.md }}>
          <Label>10-QUESTION TOPIC CHECK</Label>
          {quizResult ? (
            <>
              <Text style={s.h1}>{quizResult.score}/10</Text>
              <Text style={s.h3}>{quizResult.passed ? "You passed" : "Not quite yet"}</Text>
              <Muted>{quizResult.passed ? "This topic is complete." : "You need at least 7 correct answers. Review the topic and try a fresh set of questions."}</Muted>
              <Btn label="Try again" disabled={quizBusy} onPress={retryCompletionQuiz} />
              <Btn ghost label="Close" onPress={() => { setCompletionQuiz(null); setQuizResult(null); }} />
            </>
          ) : (() => {
            const question = completionQuiz.questions[quizIndex];
            const selected = quizAnswers[question.id];
            return (
              <>
                <View style={[s.row, { justifyContent: "space-between", alignItems: "center" }]}>
                  <Muted>Question {quizIndex + 1} of 10</Muted>
                  <Tag label="Pass: 7/10" color={colors.teal} />
                </View>
                <View style={{ marginTop: spacing.sm }}>
                  <Bar value={(quizIndex + 1) / 10} color={colors.teal} />
                </View>
                <Text style={[s.h3, { marginTop: spacing.md }]}>{question.question}</Text>
                {question.options.map((option, optionIndex) => (
                  <Card
                    key={question.id + "-" + optionIndex}
                    onPress={() => setQuizAnswers((current) => ({ ...current, [question.id]: optionIndex }))}
                    style={{
                      marginTop: spacing.sm,
                      backgroundColor: selected === optionIndex ? colors.tealTint : undefined,
                      borderWidth: selected === optionIndex ? 1 : 0,
                      borderColor: colors.teal,
                    }}
                  >
                    <View style={s.row}>
                      <Text style={[s.h3, { color: selected === optionIndex ? colors.teal : colors.textMuted }]}>{String.fromCharCode(65 + optionIndex)}.</Text>
                      <Text style={[type.body, { color: colors.text, flex: 1 }]}>{option}</Text>
                    </View>
                  </Card>
                ))}
                <View style={[s.row, { marginTop: spacing.md }]}>
                  {quizIndex > 0 && <View style={{ flex: 1 }}><Btn ghost label="Previous" onPress={() => setQuizIndex((i) => i - 1)} /></View>}
                  <View style={{ flex: 1 }}>
                    {quizIndex < 9
                      ? <Btn label="Next question" disabled={selected === undefined} onPress={() => setQuizIndex((i) => i + 1)} />
                      : <Btn label={quizBusy ? "Checking answers…" : "Submit 10 answers"} disabled={quizBusy || Object.keys(quizAnswers).length !== 10} onPress={submitCompletion} />}
                  </View>
                </View>
                <Btn ghost label="Cancel check" disabled={quizBusy} onPress={() => { setCompletionQuiz(null); setQuizAnswers({}); setQuizResult(null); }} />
              </>
            );
          })()}
        </Card>
      )}

      <Label>AI GUIDE</Label>
      <Card>
        <Muted>Stuck on something in this topic? Your study companion can explain it, give hints, or quiz you.</Muted>
        <Btn ghost label="Explain this topic to me" onPress={() => askAi()} />
        <Btn ghost label="Quiz me on what I've read" onPress={() => askAi("Ask me 3 short questions one at a time, and give hints rather than answers if I'm wrong.")} />
      </Card>

      <Label>PRACTICE</Label>
      {!finished ? (
        <Card><Text style={s.h3}>Locked</Text><Muted>Finish this topic to unlock its practice questions. You can retake them as often as you like.</Muted></Card>
      ) : practiceQs.length === 0 ? (
        <Card><Muted>Your teacher hasn't added practice questions for this topic yet.</Muted></Card>
      ) : (
        <Card>
          <Text style={s.h3}>{practiceQs.length} practice question{practiceQs.length === 1 ? "" : "s"}</Text>
          <Muted>Unlimited retakes. Results help your teacher see which topics need more class time.</Muted>
          <Btn label="Practise this topic" disabled={!localSubject || !localTopic} onPress={() => navigation.navigate("PracticeSession", { mode: "topic", subjectId: localSubject!.id, topicId: localTopic!.id })} />
        </Card>
      )}

      {finished && nextTopic && <Btn ghost label={`Next topic: ${nextTopic.title}`} onPress={() => navigation.replace("CourseTopic", { courseId, topicId: nextTopic.id })} />}
      {finished && !nextTopic && <Btn ghost label="Back to the course" onPress={() => navigation.goBack()} />}
    </Screen>
  );
}
