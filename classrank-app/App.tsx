import "react-native-gesture-handler"; // must be the first import, especially on Android

import React, { useEffect, useState } from "react";
import "./src/lib/webShims"; // browser-only fixes (Alert, Share); does nothing on phones
import * as SplashScreen from "expo-splash-screen";
import { applyThemeMode } from "./src/theme/tokens";
import { loadThemeMode } from "./src/theme/themeMode";

// Keep the native splash up while the saved light/dark choice is read (a few milliseconds).
SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * Entry point. Every screen builds its styles from the colour palette when its file is first loaded, so the saved
 * appearance (Light / Dark / System) must be applied BEFORE the rest of the app is loaded. That is why the real app
 * lives in src/AppRoot.tsx and is required only after the choice is known.
 */
let Root: React.ComponentType | null = null;

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    loadThemeMode().then((mode) => {
      applyThemeMode(mode);
      Root = require("./src/AppRoot").default;
      if (alive) setReady(true);
    });
    return () => { alive = false; };
  }, []);

  if (!ready || !Root) return null;
  const AppRoot = Root;
  return <AppRoot />;
}
