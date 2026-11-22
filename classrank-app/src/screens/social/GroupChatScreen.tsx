import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Modal, ScrollView, Text, TextInput, View } from "react-native";
import { colors, spacing, type } from "../../theme/tokens";
import { useApp } from "../../context/AppContext";
import ChatView from "../../components/ChatView";
import ReportModal, { ReportTarget } from "../../components/ReportModal";
import PressableScale from "../../components/animated/PressableScale";
import { fetchGroupMessages, sendGroupMsg, subscribeGroup, fetchGroupMembers, fetchBlocks, blockUser, GroupMember } from "../../lib/socialApi";
import { fetchMyGroups } from "../../lib/groupApi";
import { createGroupQuestion, fetchGroupQuestions, submitGroupQuestionAnswer, GroupQuestion } from "../../lib/groupQuestions";

export default function GroupChatScreen({ navigation, route }: any) {
  const { groupId, name } = route.params as { groupId: string; name: string };
  const { profile } = useApp();
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [questions, setQuestions] = useState<GroupQuestion[]>([]);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [report, setReport] = useState<ReportTarget | null>(null);
  const [composer, setComposer] = useState(false);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", "", "", ""]);
  const [correct, setCorrect] = useState(0);
  const [saving, setSaving] = useState(false);
  const byId = useRef(new Map<string, GroupMember>());
  const blocked = useRef(new Set<string>());

  const reloadQuestions = useCallback(async () => {
    try { setQuestions(await fetchGroupQuestions(groupId)); } catch {}
  }, [groupId]);

  useEffect(() => {
    Promise.all([
      fetchGroupMembers(groupId).then((m) => { byId.current = new Map(m.map((x) => [x.id, x])); setMembers(m); }).catch(() => {}),
      fetchBlocks().then((b) => { blocked.current = new Set(b.map((x) => x.id)); }).catch(() => {}),
      fetchMyGroups().then((g) => setOwnerId(g.find((x) => x.id === groupId)?.owner_id ?? null)).catch(() => {}),
      reloadQuestions(),
    ]).finally(() => setReady(true));
  }, [groupId, reloadQuestions]);

  const isManager = !!profile && (ownerId === profile.id || members.some((m) => m.id === profile.id && m.group_role === "admin"));
  const load = useCallback((before?: string) => fetchGroupMessages(groupId, before), [groupId]);
  const send = useCallback((body: string) => sendGroupMsg(groupId, body), [groupId]);
  const subscribe = useCallback((on: (m: any) => void, onReconnect?: () => void) =>
    subscribeGroup(groupId, (m) => { on(m); reloadQuestions(); }, () => { onReconnect?.(); reloadQuestions(); }), [groupId, reloadQuestions]);
  const nameOf = useCallback((id: string) => byId.current.get(id), []);
  const hideSender = useCallback((id: string) => blocked.current.has(id), []);

  const publishQuestion = async () => {
    if (saving) return;
    if (!question.trim() || options.some((x) => !x.trim())) {
      Alert.alert("Complete the question", "Enter the question and all four options.");
      return;
    }
    setSaving(true);
    try {
      await createGroupQuestion(groupId, question.trim(), options.map((x) => x.trim()), correct);
      setQuestion(""); setOptions(["", "", "", ""]); setCorrect(0); setComposer(false);
      await reloadQuestions();
    } catch (e: any) {
      Alert.alert("Couldn't create question", e?.message ?? "Please try again.");
    } finally { setSaving(false); }
  };

  const renderMessage = useCallback((m: any) => {
    const match = m.body.match(/^\[\[STETH_GROUP_QUESTION:([0-9a-f-]+)\]\]$/i);
    if (!match) return null;
    const q = questions.find((x) => x.id === match[1]);
    return q ? <GroupQuestionCard question={q} onAnswer={async (option) => {
      try { await submitGroupQuestionAnswer(q.id, option); await reloadQuestions(); }
      catch (e: any) { Alert.alert("Answer locked", e?.message ?? "Your first answer cannot be changed."); await reloadQuestions(); }
    }} /> : <View style={{ backgroundColor: colors.card, borderRadius: 14, padding: spacing.md }}><Text style={type.body}>Loading group question…</Text></View>;
  }, [questions, reloadQuestions]);

  if (!profile || !ready) return null;
  return (
    <View style={{ flex: 1 }}>
      <ChatView
        title={name}
        subtitle={members.length ? members.length + " members · tap for members" : "Group chat"}
        meId={profile.id} load={load} send={send} subscribe={subscribe} nameOf={nameOf} hideSender={hideSender}
        onBack={() => navigation.goBack()}
        onHeaderPress={() => navigation.navigate("GroupMembers", { groupId, name })}
        renderMessage={renderMessage}
        headerAction={isManager ? <PressableScale onPress={() => setComposer(true)} style={{ paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, backgroundColor: colors.violetTint }}><Text style={{ color: colors.violet, fontWeight: "700", fontSize: 12 }}>Create question</Text></PressableScale> : null}
        onLongPressMessage={(m) => {
          const who = byId.current.get(m.sender_id)?.name ?? m.sender_name ?? "this person";
          Alert.alert(who, undefined, [
            { text: "Report this message", onPress: () => setReport({ userId: m.sender_id, name: who, context: "group", messageId: m.id, preview: m.body }) },
            { text: "Block " + who, style: "destructive", onPress: () => Alert.alert("Block " + who + "?", "You won't see their messages in group chats or be able to message each other.", [
              { text: "Cancel", style: "cancel" },
              { text: "Block", style: "destructive", onPress: async () => { try { await blockUser(m.sender_id); blocked.current.add(m.sender_id); navigation.replace("GroupChat", { groupId, name }); } catch (e: any) { Alert.alert("Couldn't block", e?.message ?? "Try again."); } } },
            ]) },
            { text: "Cancel", style: "cancel" },
          ]);
        }}
      />
      <ReportModal target={report} onClose={() => setReport(null)} />
      <Modal visible={composer} animationType="slide" transparent onRequestClose={() => setComposer(false)}>
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "#0008" }}>
          <View style={{ backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, maxHeight: "90%" }}>
            <Text style={[type.h2, { color: colors.text }]}>Create a group question</Text>
            <Text style={[type.caption, { color: colors.textMuted, marginTop: 4 }]}>This question belongs to this group, not a course quiz.</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={{ color: colors.text, fontWeight: "700", marginTop: spacing.md }}>Question</Text>
              <TextInput value={question} onChangeText={setQuestion} multiline placeholder="Write your question…" placeholderTextColor={colors.textFaint} style={{ color: colors.text, backgroundColor: colors.paper, borderRadius: 12, padding: 12, minHeight: 76, marginTop: 6, textAlignVertical: "top" }} />
              {options.map((value, i) => <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: spacing.sm }}>
                <PressableScale onPress={() => setCorrect(i)} style={{ width: 34, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: correct === i ? colors.teal : colors.paper, borderWidth: 1, borderColor: correct === i ? colors.teal : colors.border }}><Text style={{ color: correct === i ? "#fff" : colors.text, fontWeight: "800" }}>{String.fromCharCode(65 + i)}</Text></PressableScale>
                <TextInput value={value} onChangeText={(v) => setOptions((old) => old.map((x, j) => j === i ? v : x))} placeholder={"Option " + String.fromCharCode(65 + i)} placeholderTextColor={colors.textFaint} style={{ flex: 1, color: colors.text, backgroundColor: colors.paper, borderRadius: 10, padding: 11 }} />
              </View>)}
              <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 8 }}>Tap A, B, C or D to mark the correct answer.</Text>
            </ScrollView>
            <View style={{ flexDirection: "row", gap: 10, marginTop: spacing.md }}>
              <PressableScale onPress={() => setComposer(false)} style={{ flex: 1, padding: 13, alignItems: "center", borderRadius: 12, backgroundColor: colors.paper }}><Text style={{ color: colors.text }}>Cancel</Text></PressableScale>
              <PressableScale onPress={publishQuestion} disabled={saving} style={{ flex: 1, padding: 13, alignItems: "center", borderRadius: 12, backgroundColor: colors.teal, opacity: saving ? 0.6 : 1 }}><Text style={{ color: "#fff", fontWeight: "700" }}>{saving ? "Posting…" : "Post question"}</Text></PressableScale>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function GroupQuestionCard({ question, onAnswer }: { question: GroupQuestion; onAnswer: (option: number) => Promise<void> }) {
  const locked = question.my_answer !== null && question.my_answer !== undefined;
  const [busy, setBusy] = useState(false);
  return (
    <View style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: spacing.md }}>
      <Text style={{ color: colors.violet, fontSize: 12, fontWeight: "800" }}>GROUP QUESTION · {question.author_name}</Text>
      <Text style={[type.h3, { color: colors.text, marginTop: 6 }]}>{question.question}</Text>
      {question.options.map((option, i) => {
        const selected = question.my_answer === i;
        const isCorrect = question.correct_option === i;
        return <PressableScale key={i} disabled={locked || busy} onPress={async () => { setBusy(true); try { await onAnswer(i); } finally { setBusy(false); } }}
          style={{ marginTop: 8, borderRadius: 10, padding: 11, borderWidth: 1, borderColor: locked && isCorrect ? colors.success : selected ? colors.teal : colors.border, backgroundColor: locked && isCorrect ? colors.violetTint : selected ? colors.violetTint : colors.paper }}>
          <Text style={{ color: colors.text, fontWeight: selected || (locked && isCorrect) ? "800" : "500" }}>{String.fromCharCode(65 + i)}. {option}{locked && isCorrect ? "  ✓ Correct" : selected && !question.my_is_correct ? "  · Your answer" : ""}</Text>
        </PressableScale>;
      })}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 12 }}>
        <Text style={{ color: colors.textMuted, fontSize: 12 }}>{question.answered_count} answered</Text>
        <Text style={{ color: colors.success, fontSize: 12 }}>{question.correct_count} correct</Text>
        <Text style={{ color: colors.ember, fontSize: 12 }}>{question.incorrect_count} incorrect</Text>
      </View>
      {locked && <Text style={{ color: question.my_is_correct ? colors.success : colors.ember, fontWeight: "800", marginTop: 8 }}>{question.my_is_correct ? "You got it right." : "Not quite. Your first answer is locked."}</Text>}
      {locked && question.answers.length > 0 && <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}>
        <Text style={{ color: colors.text, fontWeight: "700", marginBottom: 5 }}>Group results</Text>
        {question.answers.map((a) => <Text key={a.profile_id} style={{ color: a.is_correct ? colors.success : colors.ember, fontSize: 12, marginTop: 3 }}>{a.is_correct ? "✓" : "✕"} {a.name} · {String.fromCharCode(65 + a.selected_option)}</Text>)}
      </View>}
      {!locked && <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 8 }}>Choose one option. Your first answer cannot be changed.</Text>}
    </View>
  );
}
