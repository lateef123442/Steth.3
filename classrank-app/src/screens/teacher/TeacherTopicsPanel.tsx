import React, { useState } from "react";
import { View, Text, Alert } from "react-native";
import { colors, spacing } from "../../theme/tokens";
import PressableScale from "../../components/animated/PressableScale";
import { Btn, Card, Chip, Empty, Field, Label, Muted, Tag, s } from "../../components/study/ui";
import { ChipRow } from "../../components/responsive";
import { saveTopic, deleteTopic, moveTopic, saveResource, editFileResource, deleteCourseContent, removeMaterialFile } from "../../lib/courseApi";
import { CourseBundle, CourseTopic } from "../../lib/studyCourseSync";
import { fmtSize } from "../../lib/fileRules";
import TeacherFileUpload from "./TeacherFileUpload";
import QuestionManager from "./QuestionManager";

type Sub = "Resources" | "Practice";
const KIND_ICON = { note: "📝", link: "🔗", video: "🎬", file: "📎" } as const;

/** Topics are the spine of a course: each holds any number of resources (notes, links, videos, files) and its own practice questions. */
export default function TeacherTopicsPanel({ courseId, bundle, onChanged }: { courseId: string; bundle: CourseBundle; onChanged: () => void | Promise<void> }) {
  const topics = bundle.topics ?? [];
  const [open, setOpen] = useState<string | null>(topics[0]?.id ?? null);
  const [name, setName] = useState(""), [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<unknown>, fail: string) => {
    if (busy) return; setBusy(true);
    try { await fn(); await onChanged(); } catch (e: any) { Alert.alert(fail, e?.message ?? "Try again."); } finally { setBusy(false); }
  };
  const addTopic = () => act(async () => { const id = await saveTopic({ courseId, title: name, summary }); setName(""); setSummary(""); setOpen(id); }, "Couldn't add topic");
  const removeTopic = (t: CourseTopic) => Alert.alert(`Delete “${t.title}”?`, "Its resources and questions are kept and move to General. Students' progress on this topic is cleared.", [
    { text: "Cancel", style: "cancel" }, { text: "Delete topic", style: "destructive", onPress: () => act(() => deleteTopic(t.id), "Couldn't delete") },
  ]);

  return (
    <View>
      <Text style={s.h2}>Topics</Text>
      <Muted style={{ marginTop: 2 }}>Break the course into topics, in the order students should study them. Students must finish every topic before the test and exam unlock.</Muted>

      {topics.length === 0 && <Empty icon="🧩" title="No topics yet" body="Create the first topic below, then upload its resources." />}

      {topics.map((t, idx) => {
        const mats = bundle.materials.filter((m) => m.topic_id === t.id);
        const qs = bundle.questions.filter((q) => q.topic_id === t.id && (q.purpose ?? "practice") === "practice");
        const isOpen = open === t.id;
        return (
          <Card key={t.id} style={{ marginTop: spacing.sm, borderColor: isOpen ? colors.teal : colors.border }}>
            <PressableScale onPress={() => setOpen(isOpen ? null : t.id)}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: colors.tealTint, alignItems: "center", justifyContent: "center" }}><Text style={{ color: colors.tealDeep, fontWeight: "700" }}>{idx + 1}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.h3} numberOfLines={2}>{t.title}</Text>
                  <Muted>{mats.length} resource{mats.length === 1 ? "" : "s"} · {qs.length} practice question{qs.length === 1 ? "" : "s"}</Muted>
                </View>
                <Text style={{ color: colors.textMuted, fontSize: 18 }}>{isOpen ? "▾" : "▸"}</Text>
              </View>
            </PressableScale>
            {isOpen && <TopicBody courseId={courseId} topic={t} bundle={bundle} materials={mats} first={idx === 0} last={idx === topics.length - 1} busy={busy} act={act} onChanged={onChanged} onRemove={() => removeTopic(t)} />}
          </Card>
        );
      })}

      {bundle.materials.some((m) => !m.topic_id) && (
        <>
          <Label>GENERAL (NO TOPIC)</Label>
          <Muted>These resources aren't in a topic, so students don't have to finish them. Re-add them under a topic to include them in progress.</Muted>
          {bundle.materials.filter((m) => !m.topic_id).map((m) => <ResourceRow key={m.id} m={m} courseId={courseId} topics={topics} busy={busy} act={act} />)}
        </>
      )}

      <Label>NEW TOPIC</Label>
      <Field label="Topic name" value={name} onChangeText={setName} placeholder="e.g. Newton's laws of motion" />
      <Field label="Short description (optional)" value={summary} onChangeText={setSummary} placeholder="What students will learn" />
      <Btn label={busy ? "Adding…" : "Add topic"} disabled={busy || !name.trim()} onPress={addTopic} />
    </View>
  );
}

function ResourceRow({ m, courseId, topics, busy, act }: { m: CourseBundle["materials"][number]; courseId: string; topics: CourseTopic[]; busy: boolean; act: (fn: () => Promise<unknown>, fail: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(m.title), [body, setBody] = useState(m.body);
  const [kind, setKind] = useState<"note" | "link" | "video">(m.kind === "file" ? "note" : m.kind);
  const [topicId, setTopicId] = useState<string | null>(m.topic_id ?? null);
  const startEdit = () => { setTitle(m.title); setBody(m.body); setKind(m.kind === "file" ? "note" : m.kind); setTopicId(m.topic_id ?? null); setEditing(true); };
  const changed = title !== m.title || (m.kind !== "file" && (body !== m.body || kind !== m.kind)) || topicId !== (m.topic_id ?? null);
  const save = () => {
    if (!title.trim()) return Alert.alert("Give it a name", "The resource needs a name.");
    if (m.kind !== "file" && !body.trim()) return Alert.alert("Nothing to show", m.kind === "note" ? "Add the notes students should read." : "Add the link.");
    if (m.kind !== "file" && kind !== "note" && !/^https?:\/\//i.test(body.trim())) return Alert.alert("Check the link", "Links must start with http:// or https://");
    act(async () => {
      if (m.kind === "file") await editFileResource(m.id, title, topicId);
      else await saveResource({ id: m.id, courseId, topicId, title, kind, body });
      setEditing(false);
    }, "Couldn't save changes");
  };
  const del = () => Alert.alert("Delete this resource?", "Students lose access to it. This can't be undone.", [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: () => act(async () => { await deleteCourseContent("material", m.id); if (m.kind === "file") await removeMaterialFile(m.body); }, "Couldn't delete") },
  ]);
  if (editing) {
    return (
      <View style={{ paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
        <Text style={s.h3}>Edit {m.kind === "file" ? "file" : "resource"}</Text>
        {m.kind !== "file" && (
          <ChipRow>{(["note", "link", "video"] as const).map((k) => <Chip key={k} label={`${KIND_ICON[k]} ${k}`} on={kind === k} onPress={() => setKind(k)} />)}</ChipRow>
        )}
        <Field label="Name" value={title} onChangeText={setTitle} placeholder="Resource name" />
        {m.kind !== "file" && (
          <Field label={kind === "note" ? "Notes" : kind === "link" ? "Link (https://…)" : "Video link (https://…)"} value={body} onChangeText={setBody}
            multiline={kind === "note"} autoCapitalize="none" autoCorrect={false} keyboardType={kind === "note" ? "default" : "url"} placeholder={kind === "note" ? "Notes students should read" : "https://"} />
        )}
        {m.kind === "file" && <Muted style={{ marginTop: 4 }}>To replace the file itself, upload the new one and delete this one.</Muted>}
        {topics.length > 0 && (
          <>
            <Muted style={{ marginTop: spacing.sm, fontWeight: "600" }}>Topic</Muted>
            <ChipRow>
              <Chip label="No topic" on={topicId === null} onPress={() => setTopicId(null)} />
              {topics.map((t) => <Chip key={t.id} label={t.title} on={topicId === t.id} onPress={() => setTopicId(t.id)} />)}
            </ChipRow>
          </>
        )}
        <View style={[s.row, { marginTop: spacing.sm }]}>
          <Chip label={busy ? "Saving…" : "Save changes"} on onPress={() => { if (!busy && changed) save(); else if (!changed) setEditing(false); }} />
          <Chip label="Cancel" on={false} onPress={() => setEditing(false)} />
        </View>
      </View>
    );
  }
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
      <Text style={{ fontSize: 18, marginRight: spacing.sm }}>{KIND_ICON[m.kind]}</Text>
      <View style={{ flex: 1 }}>
        <Text style={s.h3} numberOfLines={2}>{m.title}</Text>
        <Muted numberOfLines={1}>{m.kind === "file" ? `${m.file_name ?? "file"}${m.file_size ? ` · ${fmtSize(m.file_size)}` : ""}` : m.kind === "note" ? m.body.slice(0, 70) : m.body}</Muted>
      </View>
      <PressableScale onPress={startEdit} disabled={busy} style={{ padding: spacing.sm }} accessibilityRole="button" accessibilityLabel={`Edit ${m.title}`}><Text style={[s.muted, { color: colors.teal, fontWeight: "700" }]}>Edit</Text></PressableScale>
      <PressableScale onPress={del} disabled={busy} style={{ padding: spacing.sm }}><Text style={s.muted}>Delete</Text></PressableScale>
    </View>
  );
}

function TopicBody({ courseId, topic, bundle, materials, first, last, busy, act, onChanged, onRemove }: {
  courseId: string; topic: CourseTopic; bundle: CourseBundle; materials: CourseBundle["materials"]; first: boolean; last: boolean; busy: boolean;
  act: (fn: () => Promise<unknown>, fail: string) => Promise<void>; onChanged: () => void | Promise<void>; onRemove: () => void;
}) {
  const [sub, setSub] = useState<Sub>("Resources");
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(topic.title), [summary, setSummary] = useState(topic.summary);
  const [kind, setKind] = useState<"note" | "link" | "video">("note");
  const [rTitle, setRTitle] = useState(""), [rBody, setRBody] = useState("");

  return (
    <View style={{ marginTop: spacing.md }}>
      {!!topic.summary && !editing && <Muted style={{ marginBottom: spacing.sm }}>{topic.summary}</Muted>}
      <View style={[s.row, { marginBottom: spacing.sm }]}>
        <Chip label="Rename" on={editing} onPress={() => setEditing((e) => !e)} />
        <Chip label="↑ Move up" on={false} onPress={() => !first && act(() => moveTopic(topic.id, -1), "Couldn't move")} />
        <Chip label="↓ Move down" on={false} onPress={() => !last && act(() => moveTopic(topic.id, 1), "Couldn't move")} />
        <Chip label="Delete topic" on={false} onPress={onRemove} />
      </View>
      {editing && (
        <>
          <Field value={title} onChangeText={setTitle} placeholder="Topic name" />
          <Field value={summary} onChangeText={setSummary} placeholder="Short description" />
          <Btn label="Save topic" disabled={busy || !title.trim()} onPress={() => act(async () => { await saveTopic({ id: topic.id, courseId, title, summary }); setEditing(false); }, "Couldn't save")} />
        </>
      )}

      <ChipRow>{(["Resources", "Practice"] as Sub[]).map((x) => <Chip key={x} label={x === "Practice" ? "Practice questions" : "Resources"} on={sub === x} onPress={() => setSub(x)} />)}</ChipRow>

      {sub === "Resources" && (
        <>
          {materials.length === 0 && <Muted>No resources yet. Add notes, links, videos or files below. You can add as many as you need.</Muted>}
          {materials.map((m) => <ResourceRow key={m.id} m={m} courseId={courseId} topics={bundle.topics ?? []} busy={busy} act={act} />)}

          <Label>ADD A RESOURCE</Label>
          <ChipRow>{(["note", "link", "video"] as const).map((k) => <Chip key={k} label={`${KIND_ICON[k]} ${k}`} on={kind === k} onPress={() => setKind(k)} />)}</ChipRow>
          <Field label="Name" value={rTitle} onChangeText={setRTitle} placeholder={kind === "note" ? "e.g. Lecture 1 notes" : kind === "link" ? "e.g. Khan Academy: Forces" : "e.g. Lab demonstration"} />
          <Field label={kind === "note" ? "Notes" : kind === "link" ? "Link (https://…)" : "Video link (https://…)"} value={rBody} onChangeText={setRBody}
            placeholder={kind === "note" ? "Type or paste the notes students should read" : "https://"} multiline={kind === "note"} autoCapitalize="none" autoCorrect={false} keyboardType={kind === "note" ? "default" : "url"} />
          <Btn label="Add resource" disabled={busy || !rTitle.trim() || !rBody.trim()} onPress={() => {
            if (kind !== "note" && !/^https?:\/\//i.test(rBody.trim())) return Alert.alert("Check the link", "Links must start with http:// or https://");
            act(async () => { await saveResource({ courseId, topicId: topic.id, title: rTitle, kind, body: rBody }); setRTitle(""); setRBody(""); }, "Couldn't add");
          }} />

          <Label>OR UPLOAD A FILE</Label>
          <TeacherFileUpload courseId={courseId} topicId={topic.id} onAdded={onChanged} />
        </>
      )}

      {sub === "Practice" && <QuestionManager courseId={courseId} bundle={bundle} purpose="practice" topics={bundle.topics ?? []} fixedTopicId={topic.id} onChanged={onChanged} hideTitle />}
    </View>
  );
}
