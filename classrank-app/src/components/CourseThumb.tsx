import React from "react";
import { Image, StyleProp, ImageStyle } from "react-native";
import { colors, radii } from "../theme/tokens";
import { courseThumbUrl } from "../lib/courseApi";

/** A course's picture. Renders nothing when the course has none, since the picture is optional. */
export default function CourseThumb({ path, height = 120, style }: { path?: string | null; height?: number; style?: StyleProp<ImageStyle> }) {
  const uri = courseThumbUrl(path);
  if (!uri) return null;
  return (
    <Image
      source={{ uri }}
      accessibilityIgnoresInvertColors
      accessibilityLabel="Course picture"
      resizeMode="cover"
      style={[{ width: "100%", height, borderRadius: radii.md, backgroundColor: colors.border, marginBottom: 8 }, style]}
    />
  );
}
