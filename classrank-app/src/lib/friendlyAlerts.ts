/**
 * Makes every pop-up message friendly in one place: error text passes through friendlyMessage before it is shown.
 * Imported once at start-up. Messages we don't recognise are shown unchanged.
 */
import { Alert } from "react-native";
import { friendlyMessage } from "./friendlyError";

const original = Alert.alert.bind(Alert);
(Alert as any).alert = (title: string, message?: string, ...rest: unknown[]) =>
  (original as any)(title, friendlyMessage(message) ?? message, ...rest);
