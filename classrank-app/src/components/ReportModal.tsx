import React, { useState } from "react";
import { Modal, View, Text, TextInput, ScrollView, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing, radii, type } from "../theme/tokens";
import { Btn, Chip } from "./study/ui";
import { REPORT_REASONS, ReportReason, reportUser } from "../lib/socialApi";

export interface ReportTarget { userId: string; name: string; context: "direct" | "group" | "profile"; messageId?: string | null; preview?: string }

/** Pick a reason, add details, send to the admins. The message text is attached to the report automatically. */
export default function ReportModal({ target, onClose }: { target: ReportTarget | null; onClose: (sent: boolean) => void }) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const close = (sent: boolean) => { setReason(null); setDetails(""); onClose(sent); };

  const send = async () => {
    if (!target || !reason || busy) return;
    setBusy(true);
    try {
      await reportUser({ userId: target.userId, context: target.context, messageId: target.messageId, reason, details });
      Alert.alert("Report sent", "Thank you. An admin will review it. You can also block this person so you don't see their messages.");
      close(true);
    } catch (e: any) { Alert.alert("Couldn't send the report", e?.message ?? "Try again."); } finally { setBusy(false); }
  };

  return (
    <Modal visible={!!target} animationType="slide" transparent onRequestClose={() => close(false)}>
      <View style={{ flex: 1, backgroundColor: "rgba(16,22,44,0.5)", justifyContent: "flex-end" }}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <SafeAreaView edges={["bottom"]} style={{ backgroundColor: colors.paper, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, maxHeight: "90%", width: "100%", maxWidth: 560, alignSelf: "center" }}>
            <ScrollView contentContainerStyle={{ padding: spacing.xl }} keyboardShouldPersistTaps="handled">
              <Text style={[type.h2, { color: colors.text }]}>Report {target?.name}</Text>
              {!!target?.preview && <View style={{ backgroundColor: colors.card, borderRadius: radii.md, padding: spacing.md, marginTop: spacing.md, borderWidth: 1, borderColor: colors.border }}><Text style={[type.caption, { color: colors.textMuted }]}>Message</Text><Text style={[type.body, { color: colors.text, marginTop: 2 }]} numberOfLines={4}>{target.preview}</Text></View>}
              <Text style={[type.label, { color: colors.textMuted, marginTop: spacing.lg, marginBottom: spacing.sm }]}>WHAT'S WRONG?</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                {REPORT_REASONS.map((r) => <Chip key={r.k} label={r.label} on={reason === r.k} onPress={() => setReason(r.k)} />)}
              </View>
              <TextInput value={details} onChangeText={setDetails} placeholder="Anything else the admin should know? (optional)" placeholderTextColor={colors.textFaint} multiline maxLength={1000}
                style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.lg, marginTop: spacing.lg, minHeight: 80, textAlignVertical: "top", color: colors.text, ...type.body }} />
              <Btn label={busy ? "Sending…" : "Send report"} onPress={send} disabled={!reason || busy} />
              <Btn ghost label="Cancel" onPress={() => close(false)} />
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
