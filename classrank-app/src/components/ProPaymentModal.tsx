import React, { useEffect, useState } from "react";
import { View, Text, Modal, ScrollView, Alert, ActivityIndicator, Share, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radii, spacing, type } from "../theme/tokens";
import PressableScale from "./animated/PressableScale";
import { Field } from "./study/ui";
import { ProGateExempt } from "./proGateCore";
import { useApp } from "../context/AppContext";
import {
  PRO_BANK, PRO_PRICE_NAIRA, uploadReceipt, openWhatsApp, redeemProCode, cleanCode, fetchMyPaymentRequests, MyPaymentRequest,
} from "../lib/proApi";

const STATUS = { pending: "Waiting for the admin", approved: "Approved — check WhatsApp for your code", rejected: "Not approved" } as const;

/**
 * How a student gets Pro: pay by bank transfer → upload the receipt → message the admin on WhatsApp → type the one-time
 * code the admin sends back. Also used from Profile to renew.
 */
export default function ProPaymentModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { profile, refreshProfileAfterPurchase } = useApp();
  const [uploading, setUploading] = useState(false);
  const [code, setCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [reqs, setReqs] = useState<MyPaymentRequest[]>([]);
  const [done, setDone] = useState<string | null>(null);

  const loadReqs = () => { fetchMyPaymentRequests().then(setReqs).catch(() => {}); };
  useEffect(() => { if (visible) { setDone(null); setCode(""); loadReqs(); } }, [visible]);

  const sendReceipt = async () => {
    if (!profile) return;
    setUploading(true);
    try {
      if (await uploadReceipt(profile.id)) { loadReqs(); Alert.alert("Receipt uploaded ✅", "Now tap “Send on WhatsApp” so the admin can send your code."); }
    } catch (e: any) { Alert.alert("Couldn't upload receipt", e?.message ?? "Check your connection and try again."); }
    finally { setUploading(false); }
  };

  const whatsapp = async () => {
    const msg = `Hello, I have paid ₦${PRO_PRICE_NAIRA} for Steth Pro.\nName: ${profile?.name ?? ""}\nPlease send my access code. I've uploaded my receipt in the app.`;
    if (!(await openWhatsApp(msg))) Alert.alert("Couldn't open WhatsApp", "Please message 09049348938 on WhatsApp with your name and payment receipt.");
  };

  const redeem = async () => {
    if (code.length !== 13 || redeeming) return;
    setRedeeming(true);
    try {
      const r = await redeemProCode(code);
      if (!r.ok) { Alert.alert("Code not accepted", r.error); return; }
      await refreshProfileAfterPurchase();
      setDone(r.duration_days === 30 ? "1 month" : `${r.duration_days} days`);
    } catch (e: any) { Alert.alert("Couldn't check code", e?.message ?? "Check your connection and try again."); }
    finally { setRedeeming(false); }
  };

  const shareAccount = () => Share.share({ message: `${PRO_BANK.bank}\nAccount number: ${PRO_BANK.accountNumber}` }).catch(() => {});

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ProGateExempt>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }}>
        <View style={st.top}>
          <Text style={[type.h2, { color: colors.text }]}>👑 Steth Pro</Text>
          <PressableScale onPress={onClose} style={{ padding: spacing.sm }} accessibilityLabel="Close"><Text style={{ fontSize: 22, color: colors.textMuted }}>✕</Text></PressableScale>
        </View>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, width: "100%", maxWidth: 560, alignSelf: "center" }} keyboardShouldPersistTaps="handled">
          {done ? (
            <View style={[st.card, { alignItems: "center", gap: spacing.sm }]}>
              <Text style={{ fontSize: 44 }}>🎉</Text>
              <Text style={[type.h2, { color: colors.text }]}>You're Pro!</Text>
              <Text style={[type.body, { color: colors.textMuted, textAlign: "center" }]}>{done} of access added to your account.</Text>
              <PressableScale style={st.primary} onPress={onClose}><Text style={st.primaryText}>Start learning</Text></PressableScale>
            </View>
          ) : (
            <>
              <View style={st.card}>
                <Text style={st.step}>1 · Pay by bank transfer</Text>
                <Text style={[type.body, { color: colors.textMuted }]}>Pro starts from <Text style={{ fontWeight: "800", color: colors.text }}>₦{PRO_PRICE_NAIRA.toLocaleString()}</Text> per month.</Text>
                <View style={st.account}>
                  <Text style={st.bank}>{PRO_BANK.bank}</Text>
                  <Text selectable style={st.acct}>{PRO_BANK.accountNumber}</Text>
                  {!!PRO_BANK.accountName && <Text style={{ color: colors.textMuted }}>{PRO_BANK.accountName}</Text>}
                </View>
                <PressableScale style={st.ghost} onPress={shareAccount}><Text style={st.ghostText}>Copy / share account number</Text></PressableScale>
              </View>

              <View style={st.card}>
                <Text style={st.step}>2 · Upload your payment receipt</Text>
                <PressableScale style={[st.primary, uploading && { opacity: 0.6 }]} onPress={sendReceipt} disabled={uploading}>
                  {uploading ? <ActivityIndicator color="#fff" /> : <Text style={st.primaryText}>📤 Upload receipt</Text>}
                </PressableScale>
                {reqs.slice(0, 3).map((r) => (
                  <Text key={r.id} style={{ color: r.status === "rejected" ? colors.danger : colors.textMuted, fontSize: 13 }}>
                    {new Date(r.created_at).toLocaleDateString()} · {STATUS[r.status]}{r.status === "rejected" && r.admin_note ? ` (${r.admin_note})` : ""}
                  </Text>
                ))}
              </View>

              <View style={st.card}>
                <Text style={st.step}>3 · Tell the admin on WhatsApp</Text>
                <PressableScale style={[st.primary, { backgroundColor: "#25D366" }]} onPress={whatsapp}><Text style={st.primaryText}>💬 Send on WhatsApp (09049348938)</Text></PressableScale>
                <Text style={{ color: colors.textMuted, fontSize: 13 }}>The admin checks your payment and sends you a 13-character code. It works once.</Text>
              </View>

              <View style={st.card}>
                <Text style={st.step}>4 · Enter your code</Text>
                <Field value={code} onChangeText={(t) => setCode(cleanCode(t))} placeholder="13-character code" autoCapitalize="characters" autoCorrect={false} maxLength={17} />
                <PressableScale style={[st.primary, (code.length !== 13 || redeeming) && { opacity: 0.45 }]} onPress={redeem} disabled={code.length !== 13 || redeeming}>
                  {redeeming ? <ActivityIndicator color="#fff" /> : <Text style={st.primaryText}>Activate Pro</Text>}
                </PressableScale>
              </View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
      </ProGateExempt>
    </Modal>
  );
}

const st = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.card },
  card: { backgroundColor: colors.card, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm, borderWidth: 1, borderColor: colors.border },
  step: { ...type.h3, color: colors.text },
  account: { backgroundColor: colors.paper, borderRadius: radii.md, padding: spacing.md, alignItems: "center", gap: 2 },
  bank: { color: colors.textMuted, fontWeight: "700" },
  acct: { fontSize: 28, letterSpacing: 2, fontWeight: "800", color: colors.tealDeep },
  primary: { backgroundColor: colors.teal, borderRadius: radii.pill, minHeight: 48, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg },
  primaryText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  ghost: { alignItems: "center", padding: spacing.sm },
  ghostText: { color: colors.tealDeep, fontWeight: "700" },
});
