import React, { useCallback, useEffect, useState } from "react";
import { View, Text, Alert, Linking } from "react-native";
import { colors, spacing, type } from "../../theme/tokens";
import PressableScale from "../../components/animated/PressableScale";
import { Back, Bar, Btn, Card, Empty, Label, Muted, Tag, s, ListSkeleton } from "../../components/study/ui";
import { Screen } from "../../components/responsive";
import { fetchCourseContent, markMaterialRead, completeTopic, materialFileUrl } from "../../lib/courseApi";
import { fmtSize } from "../../lib/fileRules";
import { CourseBundle } from "../../lib/studyCourseSync";
import { importCourseBundle, useStudy } from "../../lib/studyStore";

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
    if (busy) return; setBusy(true);
    try {
      const r = await completeTopic(topic.id);
      await load();
      Alert.alert(r.course_complete ? "Course finished 🎉" : "Topic finished ✅", r.course_complete ? "Your tests and exams are now unlocked, and every topic's practice is open." : "Practice questions for this topic are unlocked.");
    } catch (e: any) { Alert.alert("Not yet", e?.message ?? "Try again."); } finally { setBusy(false); }
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
          <Text style={s.h3}>{finished ? "Topic finished ✅" : mats.length === 0 ? "No resources in this topic yet" : `${opened} of ${mats.length} resources opened`}</Text>
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
              <Text style={{ fontSize: 22 }}>{ICON[m.kind]}</Text>
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

      {!finished && (
        <>
          <Btn label={busy ? "Saving…" : "I've finished this topic"} onPress={finish} disabled={busy || !allOpened} />
          {!allOpened && <Muted style={{ textAlign: "center" }}>Open every resource above first ({mats.length - opened} left).</Muted>}
        </>
      )}

      <Label>AI GUIDE</Label>
      <Card>
        <Muted>Stuck on something in this topic? Your study companion can explain it, give hints, or quiz you.</Muted>
        <Btn ghost label="🤖 Explain this topic to me" onPress={() => askAi()} />
        <Btn ghost label="🤖 Quiz me on what I've read" onPress={() => askAi("Ask me 3 short questions one at a time, and give hints rather than answers if I'm wrong.")} />
      </Card>

      <Label>PRACTICE</Label>
      {!finished ? (
        <Card><Text style={s.h3}>🔒 Locked</Text><Muted>Finish this topic to unlock its practice questions. You can retake them as often as you like.</Muted></Card>
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
