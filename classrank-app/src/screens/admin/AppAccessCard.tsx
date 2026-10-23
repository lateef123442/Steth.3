import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Alert, ActivityIndicator } from "react-native";
import { colors, radii, spacing } from "../../theme/tokens";
import PressableScale from "../../components/animated/PressableScale";
import { useApp } from "../../context/AppContext";
import { fetchPaywallInfo, setPaywallEnabled, PaywallInfo } from "../../lib/adminApi";

/** The admin's switch: keep Steth free for everyone, or require Pro from students. */
export default function AppAccessCard() {
  const { refreshAppConfig } = useApp();
  const [info, setInfo] = useState<PaywallInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setInfo(await fetchPaywallInfo()); setError(null); }
    catch (e: any) { setError(/could not find|schema cache/i.test(e?.message ?? "") ? "Run the database update (038) to use this switch." : (e?.message ?? "Couldn't load this setting.")); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const apply = async (enabled: boolean) => {
    setBusy(true);
    try { setInfo(await setPaywallEnabled(enabled)); await refreshAppConfig(); }
    catch (e: any) { Alert.alert("Couldn't change it", e?.message ?? "Please try again."); }
    finally { setBusy(false); }
  };

  const choose = (enabled: boolean) => {
    if (!info || busy || info.paywall_enabled === enabled) return;
    if (enabled) {
      Alert.alert(
        "Make Steth paid?",
        `Students will need an active Pro subscription (or a code) to use the app. ${info.students_without_pro} of ${info.students_total} students have no active Pro and would be asked to subscribe. Teachers and admins are not affected.`,
        [{ text: "Cancel", style: "cancel" }, { text: "Make it paid", style: "destructive", onPress: () => apply(true) }],
      );
    } else {
      Alert.alert(
        "Make Steth free?",
        "Every student will be able to use everything without a subscription. Pro time students already have is kept for when you switch back.",
        [{ text: "Cancel", style: "cancel" }, { text: "Make it free", onPress: () => apply(false) }],
      );
    }
  };

  const paid = info?.paywall_enabled === true;
  return (
    <View style={st.card}>
      <Text style={st.title}>App access</Text>
      {!info && !error && <ActivityIndicator color={colors.teal} style={{ marginVertical: spacing.md }} />}
      {!!error && <Text style={st.error}>{error}</Text>}
      {!!info && (
        <>
          <Text style={st.hint}>{paid ? "Steth is PAID: students need Pro." : "Steth is FREE: everyone can use everything."}</Text>
          <View style={st.row}>
            <PressableScale style={[st.option, !paid && st.optionOn]} onPress={() => choose(false)} haptic="light" accessibilityRole="button" accessibilityState={{ selected: !paid }}>
              <Text style={[st.optionText, !paid && { color: "#fff" }]}>🎁 Free</Text>
            </PressableScale>
            <PressableScale style={[st.option, paid && st.optionOn]} onPress={() => choose(true)} haptic="light" accessibilityRole="button" accessibilityState={{ selected: paid }}>
              <Text style={[st.optionText, paid && { color: "#fff" }]}>👑 Paid</Text>
            </PressableScale>
          </View>
          <Text style={st.small}>{info.students_without_pro} of {info.students_total} students have no active Pro right now.</Text>
        </>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginTop: spacing.lg },
  title: { color: colors.text, fontWeight: "800", fontSize: 15 },
  hint: { color: colors.textMuted, marginTop: 4 },
  row: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  option: { flex: 1, paddingVertical: spacing.md, borderRadius: radii.md, alignItems: "center", backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.border },
  optionOn: { backgroundColor: colors.teal, borderColor: colors.teal },
  optionText: { color: colors.text, fontWeight: "700" },
  small: { color: colors.textFaint, marginTop: spacing.sm, fontSize: 12 },
  error: { color: colors.danger, marginTop: spacing.sm },
});
