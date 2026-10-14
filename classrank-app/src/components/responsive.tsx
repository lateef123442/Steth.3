import React from "react";
import { View, ScrollView, StyleProp, ViewStyle, useWindowDimensions, RefreshControlProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing } from "../theme/tokens";

/**
 * One place that decides how the app lays out on a phone, a tablet or a desktop browser.
 *   compact  < 600   phones                      1 column, bottom tabs
 *   medium   600-1023 large phones / tablets     2 columns
 *   wide     >= 1024  landscape tablets / web    3 columns, side navigation rail
 */
export type Size = "compact" | "medium" | "wide";
export function useLayout() {
  const { width, height } = useWindowDimensions();
  const size: Size = width >= 1024 ? "wide" : width >= 600 ? "medium" : "compact";
  return {
    width, height, size,
    isCompact: size === "compact", isWide: size === "wide",
    columns: size === "wide" ? 3 : size === "medium" ? 2 : 1,
    pad: size === "compact" ? spacing.lg : spacing.xxl,
    /** Content never stretches wider than this, so lines stay readable on big screens. */
    maxWidth: size === "wide" ? 1120 : 820,
  };
}

/**
 * Standard screen: safe-area aware, scrolls, keeps its content centred with a readable max width and the right
 * padding for the current screen size. Use `wide` for dashboards/grids that benefit from the full 1120px.
 */
export function Screen({ children, refreshControl, contentStyle, wide, header }: {
  children: React.ReactNode; refreshControl?: React.ReactElement<RefreshControlProps>;
  contentStyle?: StyleProp<ViewStyle>; wide?: boolean; header?: React.ReactNode;
}) {
  const { pad, maxWidth } = useLayout();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }} edges={["top", "left", "right"]}>
      {header}
      <ScrollView
        refreshControl={refreshControl} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
        contentContainerStyle={{ alignItems: "center", paddingBottom: spacing.xxxl * 2 }}
      >
        <View style={[{ width: "100%", maxWidth: wide ? 1120 : maxWidth, padding: pad }, contentStyle]}>{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

/** Lays children out in 1/2/3 equal columns depending on screen size (never more than `max`). */
export function Grid({ children, max = 3, gap = spacing.sm, min }: { children: React.ReactNode; max?: number; gap?: number; min?: number }) {
  const { columns } = useLayout();
  const cols = Math.max(min ?? 1, Math.min(max, columns));
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", marginHorizontal: -gap / 2 }}>
      {items.map((c, i) => (
        <View key={i} style={{ width: `${100 / cols}%`, paddingHorizontal: gap / 2 }}>{c}</View>
      ))}
    </View>
  );
}

/** Horizontally scrolling row of chips/tabs that never wraps awkwardly on narrow screens. */
export function ChipRow({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: spacing.md, flexGrow: 0 }} contentContainerStyle={{ gap: spacing.sm, paddingRight: spacing.lg }}>
      {children}
    </ScrollView>
  );
}

/** Spread into a ScrollView's contentContainerStyle to centre content and keep lines readable on tablets / desktop. */
export const WRAP = { width: "100%", maxWidth: 820, alignSelf: "center" } as const;
