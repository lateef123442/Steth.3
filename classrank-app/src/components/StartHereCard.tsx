import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors, radii, spacing, type } from "../theme/tokens";
import PressableScale from "./animated/PressableScale";

const KEY = "steth.startHereDismissed";

const STEPS: { icon: string; title: string; hint: string; target: string }[] = [
  { icon: "🎯", title: "Do today's quiz", hint: "Answer a few questions and earn points.", target: "Quiz" },
  { icon: "📚", title: "Learn your courses", hint: "Read notes and watch videos.", target: "Learn" },
  { icon: "🤖", title: "Ask the AI helper", hint: "Stuck? Ask it anything.", target: "Companion" },
];

/** A friendly three-step guide for people who are new. Big icons, short words, one tap each. It can be hidden for good. */
export default function StartHereCard({ onGo }: { onGo: (target: string) => void }) {
  const [hidden, setHidden] = useState(true); // stay hidden until we know, so it never flashes
  useEffect(() => { AsyncStorage.getItem(KEY).then((v) => setHidden(v === "1")).catch(() => setHidden(false)); }, []);
  if (hidden) return null;

  const hide = () => { setHidden(true); AsyncStorage.setItem(KEY, "1").catch(() => {}); };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>👋 New here? Start here</Text>
      <Text style={styles.sub}>Tap any big button to begin.</Text>
      {STEPS.map((s, i) => (
        <PressableScale key={s.target} style={styles.row} onPress={() => onGo(s.target)} accessibilityRole="button" accessibilityLabel={`${s.title}. ${s.hint}`}>
          <View style={styles.badge}><Text style={styles.badgeText}>{i + 1}</Text></View>
          <Text style={styles.icon}>{s.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{s.title}</Text>
            <Text style={styles.rowHint}>{s.hint}</Text>
          </View>
          <Text style={styles.arrow}>›</Text>
        </PressableScale>
      ))}
      <PressableScale onPress={hide} style={styles.hide} haptic="none" accessibilityRole="button" accessibilityLabel="Hide this guide">
        <Text style={styles.hideText}>Got it, hide this</Text>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginHorizontal: spacing.lg, marginTop: spacing.lg },
  title: { ...type.h2, color: colors.text },
  sub: { ...type.body, color: colors.textMuted, marginTop: 2, marginBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.paper, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginTop: spacing.sm, minHeight: 68 },
  badge: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.teal, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  icon: { fontSize: 30 },
  rowTitle: { ...type.h3, color: colors.text },
  rowHint: { ...type.body, color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  arrow: { fontSize: 28, color: colors.textFaint },
  hide: { alignSelf: "center", paddingVertical: spacing.md, paddingHorizontal: spacing.lg, marginTop: spacing.xs },
  hideText: { ...type.bodySemibold, color: colors.textMuted },
});
