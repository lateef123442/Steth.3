import React, { useCallback, useEffect, useState } from "react";
import { View, Text, Alert, RefreshControl } from "react-native";
import { colors, spacing } from "../theme/tokens";
import { useApp } from "../context/AppContext";
import { Back, Btn, Card, Chip, Empty, Field, Label, Muted, Tag, s } from "../components/study/ui";
import { Screen, ChipRow } from "../components/responsive";
import { submitFeedback, fetchMyFeedback, subscribeInbox, MyFeedback, FeedbackCategory, CATEGORY_LABEL, STATUS_LABEL } from "../lib/supportApi";

const TONE = { open: colors.ember, in_progress: colors.violet, resolved: colors.success } as const;

/** Send a complaint, problem or suggestion to the admins, and read their replies (live). Available to every role. */
export default function FeedbackScreen({ navigation }: any) {
  const { profile } = useApp();
  const [category, setCategory] = useState<FeedbackCategory>("complaint");
  const [subject, setSubject] = useState(""), [body, setBody] = useState("");
  const [items, setItems] = useState<MyFeedback[] | null>(null);
  const [busy, setBusy] = useState(false), [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => { try { setItems(await fetchMyFeedback()); } catch { setItems((i) => i ?? []); } }, []);
  useEffect(() => { load(); return subscribeInbox("feedback", load); }, [load]);

  const send = async () => {
    if (busy) return; setBusy(true);
    try { await submitFeedback(category, subject, body); setSubject(""); setBody(""); await load(); Alert.alert("Sent", "Thanks. An admin will read it and reply here."); }
    catch (e: any) { Alert.alert("Couldn't send", e?.message ?? "Check your connection and try again."); } finally { setBusy(false); }
  };

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Back onPress={() => navigation.goBack()} />
      <Text style={s.h1}>Help & feedback</Text>
      <Muted>Tell the admins about a problem, a complaint or an idea{profile?.name ? `, ${profile.name.split(" ")[0]}` : ""}. For someone behaving badly in chat, use Report in that chat.</Muted>

      <Label>WHAT IS IT ABOUT?</Label>
      <ChipRow>{(Object.keys(CATEGORY_LABEL) as FeedbackCategory[]).map((k) => <Chip key={k} label={CATEGORY_LABEL[k]} on={category === k} onPress={() => setCategory(k)} />)}</ChipRow>
      <Field label="Subject" value={subject} onChangeText={setSubject} placeholder="A short summary" maxLength={120} />
      <Field label="Details" value={body} onChangeText={setBody} placeholder="What happened? What did you expect?" multiline maxLength={4000} />
      <Btn label={busy ? "Sending…" : "Send to admin"} onPress={send} disabled={busy || subject.trim().length < 3 || body.trim().length < 5} />

      <Label>YOUR MESSAGES</Label>
      {items?.length === 0 && <Empty icon="📭" title="Nothing sent yet" body="Replies from the admins appear here." />}
      {items?.map((f) => (
        <Card key={f.id}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm }}>
            <Text style={[s.h3, { flex: 1 }]} numberOfLines={2}>{f.subject}</Text>
            <Tag label={STATUS_LABEL[f.status]} color={TONE[f.status]} />
          </View>
          <Muted>{CATEGORY_LABEL[f.category]} · {new Date(f.created_at).toLocaleDateString()}</Muted>
          <Text style={{ color: colors.text, marginTop: spacing.sm }}>{f.body}</Text>
          {!!f.admin_reply && (
            <View style={{ backgroundColor: colors.tealTint, borderRadius: 12, padding: spacing.md, marginTop: spacing.md }}>
              <Text style={{ color: colors.tealDeep, fontWeight: "700", marginBottom: 2 }}>Admin reply</Text>
              <Text style={{ color: colors.text }}>{f.admin_reply}</Text>
            </View>
          )}
        </Card>
      ))}
    </Screen>
  );
}
