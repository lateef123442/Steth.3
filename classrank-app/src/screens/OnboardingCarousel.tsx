import React, { useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, NativeSyntheticEvent, NativeScrollEvent, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors, radii, spacing, type } from "../theme/tokens";
import PressableScale from "../components/animated/PressableScale";

import EmojiIcon from "../components/EmojiIcon";
export const ONBOARDING_SEEN_KEY = "classrank:hasSeenOnboarding";

interface Slide {
  emoji: string;
  title: string;
  body: string;
}

const SLIDES: Slide[] = [
  {
    emoji: "👋",
    title: "Welcome to State",
    body: "Your study space. Find your courses, answer questions and see your progress in one place.",
  },
  {
    emoji: "📚",
    title: "Learn and practise",
    body: "Tap Courses to open your subjects and study materials. Tap Quiz to answer questions and earn points.",
  },
  {
    emoji: "🤝",
    title: "Get help and keep growing",
    body: "Ask the AI helper when you are stuck. Check your streak and rank as you keep learning.",
  },
];

interface Props {
  onDone: () => void;
}

export default function OnboardingCarousel({ onDone }: Props) {
  const { width: SCREEN_WIDTH } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const newIndex = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    if (newIndex !== index) setIndex(newIndex);
  };

  const handleNext = () => {
    if (index < SLIDES.length - 1) {
      const nextIndex = index + 1;
      // Update the active slide immediately. Some web/mobile ScrollView implementations
      // do not reliably emit onMomentumScrollEnd for programmatic scrollTo calls.
      setIndex(nextIndex);
      scrollRef.current?.scrollTo({ x: nextIndex * SCREEN_WIDTH, animated: true });
    } else {
      finish();
    }
  };

  const finish = async () => {
    try {
      await AsyncStorage.setItem(ONBOARDING_SEEN_KEY, "true");
    } catch {
      // Non-fatal: worst case, onboarding shows again next launch.
    }
    onDone();
  };

  return (
    <LinearGradient colors={[colors.ink, colors.inkElevated]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fill}>
      <SafeAreaView style={styles.safe}>
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={handleScroll}
        >
          {SLIDES.map((slide, i) => (
            <View key={i} style={[styles.slide, { width: SCREEN_WIDTH }]}>
              <EmojiIcon emoji={slide.emoji} style={styles.emoji} />
              <Text style={styles.title}>{slide.title}</Text>
              <Text style={styles.body}>{slide.body}</Text>
            </View>
          ))}
        </ScrollView>

        <View style={styles.footer}>
          <Text style={styles.stepText}>Step {index + 1} of {SLIDES.length}</Text>
          <View style={styles.dots}>
            {SLIDES.map((_, i) => (
              <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
            ))}
          </View>

          <PressableScale style={styles.nextButton} onPress={handleNext} haptic="medium">
            <Text style={styles.nextButtonText}>{index < SLIDES.length - 1 ? "Next" : "Enter State"}</Text>
          </PressableScale>

          {index < SLIDES.length - 1 && (
            <PressableScale onPress={finish} style={styles.skipButton} haptic="none">
              <Text style={styles.skipText}>Skip</Text>
            </PressableScale>
          )}
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  safe: { flex: 1 },
  slide: { alignItems: "center", justifyContent: "center", padding: spacing.xxxl },
  emoji: { fontSize: 64, marginBottom: spacing.xxl },
  title: { ...type.h1, color: colors.textOnDark, textAlign: "center", marginBottom: spacing.md },
  body: { ...type.body, color: colors.textOnDarkMuted, textAlign: "center", lineHeight: 22 },
  footer: { paddingHorizontal: spacing.xxl, paddingBottom: spacing.xl, alignItems: "center" },
  stepText: { ...type.caption, color: colors.textOnDarkMuted, marginBottom: spacing.sm },
  dots: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.xl },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.25)" },
  dotActive: { backgroundColor: colors.teal, width: 20 },
  nextButton: { backgroundColor: colors.teal, borderRadius: radii.md, paddingVertical: spacing.lg, paddingHorizontal: spacing.xxxl, width: "100%", alignItems: "center" },
  nextButtonText: { color: "#fff", ...type.h3 },
  skipButton: { marginTop: spacing.md, padding: spacing.sm },
  skipText: { ...type.caption, color: colors.textOnDarkMuted },
});
