import "react-native-gesture-handler";
import { Component, type ReactNode } from "react";
import { View, Text, StyleSheet } from "react-native";
import Constants from "expo-constants";
import * as Sentry from "@sentry/react-native";
import { OxSteedMobileApp } from "./src/bootstrap/OxSteedMobileApp";

const sentryDsn = Constants.expoConfig?.extra?.sentryDsn as string | undefined;

if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    enableAutoSessionTracking: true,
    tracesSampleRate: 0.1
  });
}

type BoundaryState = { error: Error | null };

class AppErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <View style={errorStyles.container}>
          <Text style={errorStyles.title}>OxSteed failed to start</Text>
          <Text style={errorStyles.message}>{this.state.error.message}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

const errorStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0b1220",
    alignItems: "center",
    justifyContent: "center",
    padding: 24
  },
  title: {
    color: "#f97316",
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 12
  },
  message: {
    color: "#f9fafb",
    fontSize: 14,
    textAlign: "center"
  }
});

function AppWithBoundary() {
  return (
    <AppErrorBoundary>
      <OxSteedMobileApp />
    </AppErrorBoundary>
  );
}

export default Sentry.wrap(AppWithBoundary);
