import React, { useEffect, useState } from "react";
import { View } from "react-native";
import AppSplash from "./components/animated/AppSplash";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { NavigationContainer, DefaultTheme, DarkTheme } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { AppProvider } from "./context/AppContext";
import { ProGateProvider } from "./components/ProGateProvider";
import RootNavigator from "./navigation/RootNavigator";
import ErrorBoundary from "./components/ErrorBoundary";
import "./lib/friendlyAlerts"; // plain-language error pop-ups
import { initErrorReporting } from "./lib/errorReporting";
import { configurePurchases } from "./lib/purchases";
import { initDeepLinking } from "./lib/deepLinking";
import { initAnalytics } from "./lib/analytics";
import { useAppFonts } from "./theme/useAppFonts";
import { colors, isDarkTheme } from "./theme/tokens";

initErrorReporting();
configurePurchases();
initAnalytics();

// React Navigation paints headers, cards and the tab bar from its own theme, so feed it the app's colours.
const base = isDarkTheme() ? DarkTheme : DefaultTheme;
const navTheme = {
  ...base,
  colors: {
    ...base.colors,
    primary: colors.teal,
    background: colors.paper,
    card: colors.card,
    text: colors.text,
    border: colors.border,
    notification: colors.ember,
  },
};

/** The real app. App.tsx loads this only after the saved light/dark choice has been applied. */
export default function AppRoot() {
  const { fontsReady, onLayoutRootView } = useAppFonts();
  const [showSplash, setShowSplash] = useState(true); // animated brand intro, layered over the app while it loads underneath

  useEffect(() => {
    const cleanup = initDeepLinking();
    return cleanup;
  }, []);

  // Splash screen stays up (see useAppFonts) until this returns true, so
  // returning null here never causes a visible blank flash.
  if (!fontsReady) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }} onLayout={onLayoutRootView}>
      <View style={{ flex: 1, backgroundColor: colors.paper }}>
        <ErrorBoundary>
          <SafeAreaProvider>
            <AppProvider>
              <ProGateProvider>
                <NavigationContainer theme={navTheme}>
                  <StatusBar style={isDarkTheme() ? "light" : "dark"} />
                  <RootNavigator />
                </NavigationContainer>
              </ProGateProvider>
            </AppProvider>
          </SafeAreaProvider>
        </ErrorBoundary>
        {showSplash && <AppSplash onDone={() => setShowSplash(false)} />}
      </View>
    </GestureHandlerRootView>
  );
}
