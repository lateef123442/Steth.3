import React, { useMemo, useState } from "react";
import { View, Text, TextInput, Alert } from "react-native";
import { colors, spacing, type } from "../../theme/tokens";
import PressableScale from "../../components/animated/PressableScale";
import { Btn, Card, Chip, Empty, Field, Label, Muted, Tag, s } from "../../components/study/ui";
import { ChipRow } from "../../components/responsive";
import { saveQuestion, deleteCourseContent } from "../../lib/courseApi";
import { CourseBundle, CourseTopic, QuestionPurpose } from "../../lib/studyCourseSync";
import { generateQuestions, FileInfo } from "../../lib/studyAi";
import { parseQuestionBlocks, ParsedQuestion } from "../../lib/bulkImport";

const LETTERS = ["A", "B", "C", "D"];
export const PURPOSE_COPY: Record<QuestionPurpose, { title: string; blurb: string }> = {
  practice: { title: "Practice questions", blurb: "Students unlock these for a topic once they finish it, and can retake them any time." },
  daily: { title: "Daily quiz questions", blurb: "Served a few at a time, at random, from topics a student has started reading. Only a student's first answer counts and earns points." },
  assessment: { title: "Test / exam question bank", blurb: "Never shown to students on their own. Pick from this bank when you schedule a practical, test or exam." },
};

/**
 * Add / list / bulk-import / AI-draft questions of ONE purpose for a course.
 * `fixedTopicId` pins everything to a topic (used inside a topic's own page); otherwise the teacher chooses a topic per question.
 */
export default function QuestionManager({ courseId, bundle, purpose, topics, fixedTopicId, onChanged, hideTitle }: {
  courseId: string; bundle: CourseBundle; purpose: QuestionPurpose; topics: CourseTopic[]; fixedTopicId?: string | null;
  onChanged: () => void | Promise<void>; hideTitle?: boolean;
}) {
  const pinned = fixedTopicId !== undefined;
  const [topicId, setTopicId] = useState<string | null>(pinned ? fixedTopicId! : null);
  const effTopic = pinned ? fixedTopicId! : topicId;
  const topicName = (id?: string | null) => topics.find((t) => t.id === id)?.title ?? "No topic";
  const [text, setText] = useState(""), [opts, setOpts] = useState(["", "", "", ""]), [right, setRight] = useState(0), [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false), [drafting, setDrafting] = useState(false);
  const [drafts, setDrafts] = useState<ParsedQuestion[]>([]);
  const [paste, setPaste] = useState("");
  const parsed = useMemo(() => (paste.trim() ? parseQuestionBlocks(paste) : null), [paste]);

  const list = bundle.questions.filter((q) => (q.purpose ?? "practice") === purpose && (!pinned || (q.topic_id ?? null) === (fixedTopicId ?? null)));
  const copy = PURPOSE_COPY[purpose];

  const run = async (fn: () => Promise<unknown>, fail: string) => {
    if (busy) return; setBusy(true);
    try { await fn(); await onChanged(); } catch (e: any) { Alert.alert(fail, e?.message ?? "Try again."); } finally { setBusy(false); }
  };
  const idFor = (name: string) => (name.trim() ? topics.find((t) => t.title.toLowerCase() === name.trim().toLowerCase())?.id ?? effTopic : effTopic);

  const add = () => {
    if (!text.trim() || opts.some((o) => !o.trim())) return Alert.alert("Incomplete", "Enter the question and all four options.");
    run(async () => {
      await saveQuestion({ courseId, topicId: effTopic, purpose, question: text, options: opts.map((o) => o.trim()), correctIndex: right, explanation: why });
      setText(""); setOpts(["", "", "", ""]); setWhy(""); setRight(0);
    }, "Couldn't save question");
  };
  const publish = async (items: ParsedQuestion[]) => {
    if (busy || !items.length) return 0; setBusy(true); let ok = 0;
    try { for (const it of items) { await saveQuestion({ courseId, topicId: idFor(it.topic), purpose, question: it.question, options: it.options, correctIndex: it.correctIndex, explanation: it.explanation }); ok++; } }
    catch (e: any) { Alert.alert("Stopped early", `${ok} of ${items.length} saved. ${e?.message ?? "Try again."}`); }
    finally { setBusy(false); await onChanged(); }
    return ok;
  };
  const del = (id: string) => Alert.alert("Delete question?", "This can't be undone.", [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => run(() => deleteCourseContent("question", id), "Couldn't delete") }]);

  const draftWithAi = async () => {
    if (drafting) return; setDrafting(true);
    try {
      const inTopic = (m: { topic_id?: string | null }) => !effTopic || m.topic_id === effTopic;
      const notes = bundle.materials.filter((m) => m.kind !== "file").filter(inTopic).map((m) => `${m.title}: ${m.body}`).join("\n");
      const files = bundle.materials.filter((m) => m.kind === "file").filter(inTopic).slice(-3).map((m) => m.body);
      let info: FileInfo | null = null;
      const made = await generateQuestions({ subject: `${bundle.course.code} ${bundle.course.title}`, topic: effTopic ? topicName(effTopic) : undefined, notes, files, onFiles: (i) => { info = i; }, count: 5 });
      setDrafts(made.map((m) => ({ topic: effTopic ? topicName(effTopic) : "", question: m.q, options: m.options, correctIndex: m.correct, explanation: m.explanation })));
      const skipped = (info as FileInfo | null)?.skipped ?? 0;
      if (skipped > 0) Alert.alert("Some files weren't used", `${skipped} attached file${skipped === 1 ? "" : "s"} couldn't be read, so those questions use your notes and the other files.`);
    } catch { Alert.alert("Couldn't draft questions", "The AI service is unreachable. Check your connection."); } finally { setDrafting(false); }
  };

  const hasSource = bundle.materials.some((m) => (!effTopic || m.topic_id === effTopic));

  return (
    <View>
      {!hideTitle && <><Text style={s.h2}>{copy.title}</Text><Muted style={{ marginTop: 2 }}>{copy.blurb}</Muted></>}
      <Muted style={{ marginTop: spacing.sm }}>{list.length} question{list.length === 1 ? "" : "s"}{pinned ? " in this topic" : ""}</Muted>
      {list.length === 0 && <Empty icon="📝" title="No questions yet" body="Add one below, paste many at once, or let AI draft some from your resources." />}
      {list.map((q) => (
        <Card key={q.id} style={{ flexDirection: "row", alignItems: "center", marginTop: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Text style={type.bodyMedium} numberOfLines={2}>{q.question}</Text>
            <Muted>{q.topic || "No topic"} · answer {LETTERS[q.correct_index]}</Muted>
          </View>
          <PressableScale onPress={() => del(q.id)} style={{ padding: spacing.sm }}><Text style={s.muted}>Delete</Text></PressableScale>
        </Card>
      ))}

      <Label>ADD A QUESTION</Label>
      {!pinned && (
        <>
          <Muted style={{ fontWeight: "600" }}>Topic{purpose === "daily" ? " (students unlock it by reading this topic)" : ""}</Muted>
          <ChipRow>
            <Chip label="No topic" on={topicId === null} onPress={() => setTopicId(null)} />
            {topics.map((t) => <Chip key={t.id} label={t.title} on={topicId === t.id} onPress={() => setTopicId(t.id)} />)}
          </ChipRow>
        </>
      )}
      <Field value={text} onChangeText={setText} placeholder="Question" multiline />
      {opts.map((o, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <PressableScale onPress={() => setRight(i)} style={{ marginTop: spacing.sm, width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: right === i ? colors.success : colors.border }}>
            <Text style={[type.label, { color: right === i ? "#fff" : colors.text }]}>{LETTERS[i]}</Text>
          </PressableScale>
          <TextInput style={[s.input, { flex: 1 }]} value={o} onChangeText={(v) => setOpts(opts.map((x, k) => (k === i ? v : x)))} placeholder={`Option ${LETTERS[i]}`} placeholderTextColor={colors.textFaint} />
        </View>
      ))}
      <Muted style={{ marginTop: 4 }}>Tap a letter to mark the correct answer (green).</Muted>
      <Field value={why} onChangeText={setWhy} placeholder="Explanation shown after answering (the AI guide builds on this)" />
      <Btn label={busy ? "Saving…" : "Add question"} disabled={busy} onPress={add} />

      <Label>DRAFT WITH AI</Label>
      <Muted>Drafts 5 questions from {effTopic ? `“${topicName(effTopic)}”` : "this course's resources"}. Check each one: AI can be wrong. Nothing reaches students until you publish it.</Muted>
      <Btn ghost label={drafting ? "Drafting…" : "✨ Draft 5 questions"} onPress={draftWithAi} disabled={drafting || !hasSource} />
      {!hasSource && <Muted>Add a resource first so the questions are based on your content.</Muted>}
      {drafts.map((d, i) => (
        <Card key={i} style={{ marginTop: spacing.sm }}>
          <Text style={s.h3}>{d.question}</Text>
          {d.options.map((o, k) => <Text key={k} style={[type.body, { color: k === d.correctIndex ? colors.success : colors.text, marginTop: 2 }]}>{LETTERS[k]}. {o}{k === d.correctIndex ? "  ✓" : ""}</Text>)}
          {!!d.explanation && <Muted style={{ marginTop: 6 }}>{d.explanation}</Muted>}
          <View style={[s.row, { marginTop: spacing.sm }]}>
            <Chip label="Publish" on onPress={async () => { if (await publish([d])) setDrafts((x) => x.filter((_, k) => k !== i)); }} />
            <Chip label="Discard" on={false} onPress={() => setDrafts((x) => x.filter((_, k) => k !== i))} />
          </View>
        </Card>
      ))}
      {drafts.length > 1 && <Btn label={`Publish all ${drafts.length}`} disabled={busy} onPress={async () => { if (await publish(drafts)) setDrafts([]); }} />}

      <Label>PASTE MANY QUESTIONS</Label>
      <Muted>One block per question, blank line between: "Q:" text, options A) to D), then "Answer: B". Optional "Why:" and "Topic:" (a topic name from this course) lines.</Muted>
      <TextInput style={[s.input, { minHeight: 130, textAlignVertical: "top" }]} multiline value={paste} onChangeText={setPaste} autoCapitalize="none"
        placeholder={"Q: What is the SI unit of force?\nA) Joule\nB) Newton\nC) Watt\nD) Pascal\nAnswer: B\nWhy: F = ma, measured in newtons."} placeholderTextColor={colors.textFaint} />
      {parsed && (
        <>
          <Muted style={{ marginTop: 6 }}>{parsed.questions.length} ready{parsed.errors.length ? ` · ${parsed.errors.length} with problems (skipped)` : ""}</Muted>
          {parsed.errors.map((e) => <Text key={e.block} style={[type.caption, { color: colors.danger }]}>Question {e.block}: {e.message}</Text>)}
          <Btn label={`Import ${parsed.questions.length} question${parsed.questions.length === 1 ? "" : "s"}`} disabled={busy || parsed.questions.length === 0}
            onPress={async () => { const n = await publish(parsed.questions); if (n === parsed.questions.length) { setPaste(""); Alert.alert("Imported", `${n} questions saved.`); } }} />
        </>
      )}
    </View>
  );
}
