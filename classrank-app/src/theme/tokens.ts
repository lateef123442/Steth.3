import { Appearance } from "react-native";

/**
 * Steth design tokens.
 *
 * Design direction: the app's subject is climbing a rank — competing,
 * rising, crossing thresholds. The signature element (PulseRing, see
 * components/animated/PulseRing.tsx) is a circular progress ring that fills
 * as you climb and bursts on a threshold crossing. Home's hero is a dark
 * "arena" surface — your stats displayed like a scoreboard under stadium
 * lights — contrasted with a calm, light body below. That contrast is the
 * structural idea everything else is built around; keep it, don't dilute it
 * by making every screen dark or every screen light.
 *
 * Points and rank deliberately have different accent colors (teal vs.
 * violet) so the two concepts stay visually distinct at a glance — this
 * matters because the whole fairness pitch of the app is "points and rank
 * aren't the same thing across departments."
 */

const lightColors = {
  // Arena surfaces (dark) — used for hero/scoreboard moments only.
  ink: "#10162C",
  /** Legacy alias used by older screens (see theme/colors.ts). Same value as ink. */
  navy: "#10162C",
  inkElevated: "#1B2444",
  inkBorder: "#2C355C",

  // Paper surfaces (light) — used for everything else.
  paper: "#F7F8FC",
  card: "#FFFFFF",
  border: "#E7E9F2",

  // Accents — each concept gets its own color, used consistently.
  teal: "#14B8A6", // points, primary CTAs
  tealDeep: "#0D9488",
  tealTint: "#E3FBF7",
  violet: "#7C6CF5", // rank / percentile
  violetTint: "#EEECFF",
  ember: "#FF8A3D", // streak fire
  emberTint: "#FFF1E6",

  // Podium
  gold: "#F5C344",
  silver: "#C7CEDA",
  bronze: "#D89A6A",

  // Semantic
  success: "#22C55E",
  successTint: "#E8FBF0",
  danger: "#EF4444",
  dangerTint: "#FDECEC",

  // Text
  text: "#1A1F36",
  textMuted: "#6B7280",
  textFaint: "#9CA3AF",
  textOnDark: "#F7F8FC",
  textOnDarkMuted: "#9CA6C4",
};

/**
 * Dark palette. Same keys as the light one, so every screen keeps working unchanged.
 * `navy` doubles as a button background (white text on top) in many screens, so in dark mode it is a mid indigo
 * that stands out on dark cards; text that used to be navy now uses `text`.
 */
const darkColors: typeof lightColors = {
  ink: "#141B38",
  navy: "#3A4A8C",
  inkElevated: "#1F2A52",
  inkBorder: "#303B6B",

  paper: "#0B0F1F",
  card: "#141B33",
  border: "#262F55",

  teal: "#14B8A6",
  tealDeep: "#2DD4BF",
  tealTint: "#0F3433",
  violet: "#8E80FF",
  violetTint: "#26224F",
  ember: "#FF9A52",
  emberTint: "#3D2616",

  gold: "#F5C344",
  silver: "#C7CEDA",
  bronze: "#D89A6A",

  success: "#34D17A",
  successTint: "#123422",
  danger: "#F87171",
  dangerTint: "#3F1D22",

  text: "#ECEFF8",
  textMuted: "#A0A9C4",
  textFaint: "#707A9B",
  textOnDark: "#F7F8FC",
  textOnDarkMuted: "#9CA6C4",
};

export type ThemeMode = "system" | "light" | "dark";
export type ThemeScheme = "light" | "dark";

/**
 * The live palette. Screens import `colors` and read it while their styles are created, so the mode has to be
 * chosen BEFORE any screen module loads (App.tsx does that, then loads the rest of the app). Changing the mode in
 * Settings saves it and restarts the app so every screen is rebuilt with the new colours.
 */
export const colors: typeof lightColors = { ...lightColors };

let activeScheme: ThemeScheme = "light";
export const getActiveScheme = (): ThemeScheme => activeScheme;
export const isDarkTheme = (): boolean => activeScheme === "dark";

export function resolveScheme(mode: ThemeMode): ThemeScheme {
  if (mode === "light" || mode === "dark") return mode;
  return Appearance.getColorScheme() === "dark" ? "dark" : "light";
}

export function applyThemeMode(mode: ThemeMode): ThemeScheme {
  activeScheme = resolveScheme(mode);
  Object.assign(colors, activeScheme === "dark" ? darkColors : lightColors);
  return activeScheme;
}


export const radii = {
  sm: 10,
  md: 16,
  lg: 22,
  xl: 28,
  pill: 999,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

/**
 * Typography scale. Fonts are loaded via expo-font in App.tsx — see
 * useAppFonts() in this file. Fall back to system fonts gracefully if
 * fonts haven't finished loading yet (App.tsx gates rendering on this, so
 * in practice these fallbacks are rarely seen, but they keep things from
 * breaking if a font family name is ever wrong).
 */
export const fonts = {
  display: "Sora_700Bold",
  displayXBold: "Sora_800ExtraBold",
  displaySemibold: "Sora_600SemiBold",
  body: "Inter_400Regular",
  bodyMedium: "Inter_500Medium",
  bodySemibold: "Inter_600SemiBold",
  bodyBold: "Inter_700Bold",
};

export const type = {
  hero: { fontFamily: fonts.displayXBold, fontSize: 40, lineHeight: 44 },
  h1: { fontFamily: fonts.display, fontSize: 26, lineHeight: 32 },
  h2: { fontFamily: fonts.display, fontSize: 20, lineHeight: 26 },
  h3: { fontFamily: fonts.displaySemibold, fontSize: 16, lineHeight: 22 },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24 },
  bodyMedium: { fontFamily: fonts.bodyMedium, fontSize: 16, lineHeight: 24 },
  bodySemibold: { fontFamily: fonts.bodySemibold, fontSize: 16, lineHeight: 24 },
  bodyBold: { fontFamily: fonts.bodyBold, fontSize: 16, lineHeight: 24 },
  label: { fontFamily: fonts.bodySemibold, fontSize: 12, lineHeight: 16, letterSpacing: 0.4 },
  caption: { fontFamily: fonts.body, fontSize: 12, lineHeight: 16 },
};

export const shadow = {
  card: {
    shadowColor: "#0B0F1F",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  floating: {
    shadowColor: "#0B0F1F",
    shadowOpacity: 0.14,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
};

/** Shared spring/timing presets so motion feels consistent app-wide. */
export const motion = {
  springSnappy: { damping: 14, stiffness: 220, mass: 0.6 },
  springSoft: { damping: 16, stiffness: 120, mass: 0.8 },
  timingFast: { duration: 180 },
  timingMedium: { duration: 320 },
  timingSlow: { duration: 600 },
};
