import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { colors, radius } from "../theme/colors";
import { captureException } from "../lib/errorReporting";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
  componentStack: string;
}

// Catches otherwise-uncaught render errors anywhere in the tree below it.
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, errorMessage: "", componentStack: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, errorMessage: error?.message || String(error) };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const componentStack = info.componentStack || "";
    this.setState({ errorMessage: error?.message || String(error), componentStack });
    captureException(error, { componentStack });
  }

  handleReset = () => {
    this.setState({ hasError: false, errorMessage: "", componentStack: "" });
  };

  render() {
    if (this.state.hasError) {
      return (
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.subtitle}>
            The app hit an unexpected error. The details below will help us identify the cause.
          </Text>
          <View style={styles.details}>
            <Text style={styles.detailsTitle}>Error details</Text>
            <Text selectable style={styles.detailsText}>{this.state.errorMessage || "No error message was provided."}</Text>
            {!!this.state.componentStack && (
              <>
                <Text style={[styles.detailsTitle, { marginTop: 14 }]}>Component location</Text>
                <Text selectable style={styles.stackText}>{this.state.componentStack}</Text>
              </>
            )}
          </View>
          <TouchableOpacity style={styles.button} onPress={this.handleReset}>
            <Text style={styles.buttonText}>Try Again</Text>
          </TouchableOpacity>
        </ScrollView>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: colors.bg },
  title: { fontSize: 20, fontWeight: "800", color: colors.text, textAlign: "center" },
  subtitle: { fontSize: 14, color: colors.textMuted, textAlign: "center", marginTop: 8, marginBottom: 18 },
  details: { width: "100%", maxWidth: 560, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 14, marginBottom: 20 },
  detailsTitle: { fontSize: 13, fontWeight: "800", color: colors.text, marginBottom: 6 },
  detailsText: { fontSize: 13, lineHeight: 19, color: colors.danger },
  stackText: { fontSize: 11, lineHeight: 16, color: colors.textMuted },
  button: { backgroundColor: colors.teal, borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: 28 },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
