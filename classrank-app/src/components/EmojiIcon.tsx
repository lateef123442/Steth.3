import React from "react";
import { StyleProp, StyleSheet, Text, TextStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../theme/tokens";

type IconName = keyof typeof Ionicons.glyphMap;
type Tone = "teal" | "gold" | "success" | "danger" | "ember" | "violet" | "muted" | "faint" | "text";

/** One consistent, professional icon set for the whole app. Each old emoji maps to a vector icon and a brand colour. */
const MAP: Record<string, [IconName, Tone]> = {
  "✅": ["checkmark-circle", "success"], "✓": ["checkmark", "success"], "☑": ["checkbox", "teal"], "☐": ["square-outline", "muted"],
  "🎉": ["sparkles", "gold"], "✨": ["sparkles", "gold"], "🤖": ["sparkles", "violet"], "🧠": ["bulb", "gold"],
  "👑": ["diamond", "gold"], "💎": ["diamond", "gold"], "🏆": ["trophy", "gold"], "🏅": ["medal", "gold"], "⭐": ["star", "gold"],
  "✕": ["close", "muted"], "✗": ["close", "danger"], "❌": ["close-circle", "danger"],
  "💬": ["chatbubble-ellipses", "teal"], "📣": ["megaphone", "teal"], "🔔": ["notifications", "teal"], "📬": ["mail", "teal"],
  "📎": ["attach", "muted"], "🔗": ["link", "teal"], "📤": ["cloud-upload", "teal"], "➤": ["send", "teal"], "🧾": ["receipt", "muted"],
  "👥": ["people", "teal"], "🤝": ["people", "teal"], "👍": ["thumbs-up", "teal"], "👋": ["hand-left", "gold"], "🤷": ["help-circle", "muted"], "❓": ["help-circle", "muted"],
  "📚": ["book", "teal"], "📘": ["book", "teal"], "📝": ["document-text", "teal"], "🎓": ["school", "teal"], "📭": ["file-tray", "faint"],
  "🎯": ["locate", "teal"], "🏁": ["flag", "teal"], "🧩": ["extension-puzzle", "violet"], "🔁": ["repeat", "teal"], "⚡": ["flash", "ember"],
  "🔥": ["flame", "ember"], "🛡️": ["shield-checkmark", "teal"], "🛡": ["shield-checkmark", "teal"], "🔒": ["lock-closed", "muted"], "🔑": ["key", "gold"],
  "⚠️": ["warning", "ember"], "⚠": ["warning", "ember"], "🎬": ["play-circle", "teal"], "🗓": ["calendar", "teal"],
  "📈": ["trending-up", "success"], "📉": ["trending-down", "danger"], "🔍": ["search", "muted"], "➕": ["add", "teal"],
  "🎁": ["gift", "violet"], "💜": ["heart", "violet"], "♥": ["heart", "danger"], "♡": ["heart-outline", "muted"],
  "☕": ["cafe", "muted"], "🌅": ["sunny", "gold"], "☀️": ["sunny", "gold"], "☀": ["sunny", "gold"], "🌙": ["moon", "violet"], "🌗": ["contrast", "muted"],
  "📱": ["phone-portrait", "muted"], "🙈": ["eye-off", "muted"], "👁": ["eye", "muted"],
  "🔴": ["ellipse", "danger"], "🟠": ["ellipse", "ember"], "⚪": ["ellipse", "faint"],
};

function toneColor(t: Tone): string {
  switch (t) {
    case "gold": return colors.gold;
    case "success": return colors.success;
    case "danger": return colors.danger;
    case "ember": return colors.ember;
    case "violet": return colors.violet;
    case "muted": return colors.textMuted;
    case "faint": return colors.textFaint;
    case "text": return colors.text;
    default: return colors.teal;
  }
}

/** Draws a vector icon where an emoji used to be. Size and colour follow the style the emoji had, when it set them. */
export default function EmojiIcon({ emoji, size, color, style }: { emoji: string; size?: number; color?: string; style?: StyleProp<TextStyle> }) {
  const clean = emoji.trim();
  const entry = MAP[clean] ?? MAP[clean.replace(/\ufe0f/g, "")];
  if (!entry) return <Text style={style}>{emoji}</Text>; // an emoji we have no icon for (for example one stored in the database): show it as it is
  const flat = StyleSheet.flatten(style) ?? {};
  const { fontSize, color: styleColor, fontFamily: _f, fontWeight: _w, lineHeight: _l, ...layout } = flat as TextStyle;
  return <Ionicons name={entry[0]} size={size ?? fontSize ?? 20} color={color ?? (styleColor as string | undefined) ?? toneColor(entry[1])} style={layout} />;
}

/** True when this emoji has an icon, so callers can decide whether to draw one. */
export const hasEmojiIcon = (emoji: string) => !!(MAP[emoji.trim()] ?? MAP[emoji.trim().replace(/\ufe0f/g, "")]);
