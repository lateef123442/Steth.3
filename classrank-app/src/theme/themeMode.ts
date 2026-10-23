import AsyncStorage from "@react-native-async-storage/async-storage";
import { DevSettings } from "react-native";
import * as Updates from "expo-updates";
import type { ThemeMode } from "./tokens";

const KEY = "steth.themeMode";

/** Saved appearance choice. Defaults to light, which is how the app has always looked. */
export async function loadThemeMode(): Promise<ThemeMode> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    return v === "light" || v === "dark" || v === "system" ? v : "light";
  } catch {
    return "light";
  }
}

export async function saveThemeMode(mode: ThemeMode): Promise<void> {
  await AsyncStorage.setItem(KEY, mode);
}

/**
 * Screens build their styles once when the app starts, so a new theme takes effect after a restart.
 * Returns false if the app could not restart itself (the caller then asks the person to reopen it).
 */
export async function restartApp(): Promise<boolean> {
  try {
    if (__DEV__) { DevSettings.reload(); return true; }
    await Updates.reloadAsync();
    return true;
  } catch {
    return false;
  }
}
