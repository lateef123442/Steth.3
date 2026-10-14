import React from "react";
import { View, Text, Image } from "react-native";
import { colors } from "../theme/tokens";
import { avatarUrl } from "../lib/socialApi";

/** Profile picture, or a coloured initial when the person hasn't set one. */
export default function Avatar({ name, path, size = 44 }: { name: string; path?: string | null; size?: number }) {
  const uri = avatarUrl(path);
  const palette = [colors.teal, colors.violet, colors.ember, "#3B82F6", "#EC4899", "#10B981"];
  const bg = palette[(name.charCodeAt(0) || 0) % palette.length];
  if (uri) return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.border }} accessibilityLabel={`${name}'s picture`} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: "#fff", fontWeight: "700", fontSize: size * 0.42 }}>{(name.trim().charAt(0) || "?").toUpperCase()}</Text>
    </View>
  );
}
