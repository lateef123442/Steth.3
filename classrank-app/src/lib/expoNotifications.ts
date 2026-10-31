import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * Safe wrapper around `expo-notifications`.
 *
 * Since Expo SDK 53, merely *importing* expo-notifications inside Expo Go on Android throws
 * ("Android Push notifications ... was removed from Expo Go"), which crashes the whole app at startup.
 * In that one environment we skip the real module and hand back harmless stand-ins, so the app runs normally
 * (notifications just don't fire). In a development build or a store build the real module is used.
 */
type NotificationsModule = typeof import("expo-notifications");

const isExpoGoAndroid = Constants.executionEnvironment === "storeClient" && Platform.OS === "android";
// Browsers (the iPhone web version) have no app notifications either, so use the harmless stand-ins there too.
const unavailable = isExpoGoAndroid || Platform.OS === "web";

const noopSub = () => ({ remove() {} });

const stub = {
  setNotificationHandler: () => {},
  getPermissionsAsync: async () => ({ status: "denied", granted: false, canAskAgain: false, expires: "never" }),
  requestPermissionsAsync: async () => ({ status: "denied", granted: false, canAskAgain: false, expires: "never" }),
  getExpoPushTokenAsync: async () => {
    throw new Error("Push notifications aren't available in Expo Go on Android. Use a development build.");
  },
  setNotificationChannelAsync: async () => null,
  scheduleNotificationAsync: async () => "expo-go-noop",
  cancelScheduledNotificationAsync: async () => {},
  getAllScheduledNotificationsAsync: async () => [],
  getLastNotificationResponseAsync: async () => null,
  addNotificationResponseReceivedListener: noopSub,
  addNotificationReceivedListener: noopSub,
  addPushTokenListener: noopSub,
  AndroidImportance: { DEFAULT: 3, HIGH: 4, LOW: 2, MIN: 1, MAX: 5, NONE: 0, UNSPECIFIED: -1000 },
} as unknown as NotificationsModule;

const Notifications: NotificationsModule = unavailable
  ? stub
  : (require("expo-notifications") as NotificationsModule);

export default Notifications;
export const notificationsAvailable = !unavailable;
