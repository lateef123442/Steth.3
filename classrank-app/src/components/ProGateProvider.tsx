import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, Modal, ActivityIndicator, Alert, StyleSheet, KeyboardAvoidingView, Platform } from "react-native";
import { colors, radii, spacing, type } from "../theme/tokens";
import PressableScale from "./animated/PressableScale";
import ProPaymentModal from "./ProPaymentModal";
import { Field } from "./study/ui";
import { ProGateContext } from "./proGateCore";
import { useApp } from "../context/AppContext";
import { hasActivePro, redeemProCode, cleanCode, PRO_PRICE_NAIRA } from "../lib/proApi";

/**
 * Students without active Pro can look around the whole app, but the moment they try to USE something (tap a button,
 * open a quiz, start a chat…) they get this prompt: subscribe to Pro, or type a subscription code to continue.
 * Teachers and admins are never gated.
 */
export function ProGateProvider({ children }: { children: React.ReactNode }) {
  const { profile, refreshProfileAfterPurchase } = useApp();
  const [, setTick] = useState(0);
  const [open, setOpen] = useState(false);
  const [pay, setPay] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  // Re-check once a minute so access ends right when the paid time runs out.
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 60_000); return () => clearInterval(t); }, []);

  const locked = profile?.role === "student" && !hasActivePro(profile);
  const prompt = useCallback(() => { setCode(""); setOpen(true); }, []);
  useEffect(() => { if (!locked) { setOpen(false); setPay(false); } }, [locked]);
  const value = useMemo(() => ({ locked: !!locked, prompt }), [locked, prompt]);

  const activate = async () => {
    if (code.length !== 13 || busy) return;
    setBusy(true);
    try {
      const r = await redeemProCode(code);
      if (!r.ok) { Alert.alert("Code not accepted", r.error); return; }
      await refreshProfileAfterPurchase();
      setOpen(false);
      Alert.alert("You're Pro! 🎉", `${r.duration_days === 30 ? "1 month" : `${r.duration_days} days`} of access added. Enjoy!`);
    } catch (e: any) { Alert.alert("Couldn't check code", e?.message ?? "Check your connection and try again."); }
    finally { setBusy(false); }
  };

  return (
    <>
      <ProGateContext.Provider value={value}>{children}</ProGateContext.Provider>

      {/* Rendered outside the provider above so its own buttons are never gated. */}
      <Modal visible={open && !pay} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView style={st.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={st.card}>
            <Text style={{ fontSize: 40, textAlign: "center" }}>👑</Text>
            <Text style={st.title}>Subscribe to Pro to continue</Text>
            <Text style={st.body}>You can look around freely, but using this feature needs Steth Pro — from ₦{PRO_PRICE_NAIRA.toLocaleString()} per month.</Text>

            <PressableScale style={st.primary} onPress={() => setPay(true)} haptic="medium"><Text style={st.primaryText}>Subscribe to Pro</Text></PressableScale>

            <Text style={st.or}>or enter your subscription code</Text>
            <Field value={code} onChangeText={(t) => setCode(cleanCode(t))} placeholder="13-character code" autoCapitalize="characters" autoCorrect={false} maxLength={17} />
            <PressableScale style={[st.secondary, (code.length !== 13 || busy) && { opacity: 0.45 }]} onPress={activate} disabled={code.length !== 13 || busy}>
              {busy ? <ActivityIndicator color={colors.tealDeep} /> : <Text style={st.secondaryText}>Activate code</Text>}
            </PressableScale>

            <PressableScale style={{ padding: spacing.md, alignItems: "center" }} onPress={() => setOpen(false)}><Text style={{ color: colors.textMuted, fontWeight: "600" }}>Not now</Text></PressableScale>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <ProPaymentModal visible={open && pay} onClose={() => { setPay(false); }} />
    </>
  );
}

const st = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(16,22,44,0.6)", justifyContent: "center", padding: spacing.xl },
  card: { backgroundColor: colors.card, borderRadius: radii.xl, padding: spacing.xl, gap: spacing.sm, width: "100%", maxWidth: 440, alignSelf: "center" },
  title: { ...type.h2, color: colors.text, textAlign: "center" },
  body: { ...type.body, color: colors.textMuted, textAlign: "center", marginBottom: spacing.sm },
  primary: { backgroundColor: colors.teal, borderRadius: radii.pill, minHeight: 48, alignItems: "center", justifyContent: "center" },
  primaryText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  or: { textAlign: "center", color: colors.textMuted, marginTop: spacing.sm },
  secondary: { borderRadius: radii.pill, minHeight: 46, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: colors.teal },
  secondaryText: { color: colors.tealDeep, fontWeight: "800" },
});
