import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { NavigationContainer, DarkTheme, Theme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { AccountScreen } from "../screens/AccountScreen";
import { AuthScreen } from "../screens/AuthScreen";
import { BrowseHelpersScreen } from "../screens/BrowseHelpersScreen";
import { BusinessHubLiteScreen } from "../screens/BusinessHubLiteScreen";
import { CustomerHomeScreen } from "../screens/CustomerHomeScreen";
import { HelperHomeScreen } from "../screens/HelperHomeScreen";
import { MessagesScreen } from "../screens/MessagesScreen";
import { PaymentsScreen } from "../screens/PaymentsScreen";
import { PlannedNeedsScreen } from "../screens/PlannedNeedsScreen";
import { PostJobScreen } from "../screens/PostJobScreen";
import { ToolRentalsScreen } from "../screens/ToolRentalsScreen";
import { TrustSafetyScreen } from "../screens/TrustSafetyScreen";
import { AppText } from "../components/Text";
import { isEnabled } from "../config/featureFlags";
import { useAuthStore } from "../state/authStore";
import { colors, spacing } from "../theme";
import { usePushRegistration } from "./usePushRegistration";

type RootTabs = {
  Customer: undefined;
  Post: undefined;
  Helpers: undefined;
  Messages: undefined;
  Plans: undefined;
  Payments: undefined;
  Tools: undefined;
  Trust: undefined;
  Business: undefined;
  Helper: undefined;
  Account: undefined;
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1
    }
  }
});

const navTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.background,
    card: colors.panel,
    primary: colors.orange,
    text: colors.text,
    border: colors.border
  }
};

const Tabs = createBottomTabNavigator<RootTabs>();

const linking = {
  prefixes: ["oxsteed://", "https://oxsteed.com", "https://www.oxsteed.com"],
  config: {
    screens: {
      Customer: "",
      Post: "post-job",
      Helpers: "helpers/:id?",
      Messages: "messages",
      Plans: "planned-needs",
      Payments: "invoices",
      Tools: "tool-rentals/:id?",
      Trust: "disputes/:id?",
      Business: "business-hub",
      Helper: "helper-dashboard",
      Account: "account"
    }
  }
};

function SignedInTabs() {
  usePushRegistration();

  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.orange,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.panel,
          borderTopColor: colors.border
        }
      }}
    >
      {isEnabled("customerDashboard") && <Tabs.Screen name="Customer" component={CustomerHomeScreen} />}
      {isEnabled("postJob") && <Tabs.Screen name="Post" component={PostJobScreen} />}
      <Tabs.Screen name="Helpers" component={BrowseHelpersScreen} />
      <Tabs.Screen name="Messages" component={MessagesScreen} />
      <Tabs.Screen name="Plans" component={PlannedNeedsScreen} />
      <Tabs.Screen name="Payments" component={PaymentsScreen} />
      <Tabs.Screen name="Tools" component={ToolRentalsScreen} />
      <Tabs.Screen name="Trust" component={TrustSafetyScreen} />
      <Tabs.Screen name="Business" component={BusinessHubLiteScreen} />
      {isEnabled("helperDashboard") && <Tabs.Screen name="Helper" component={HelperHomeScreen} />}
      <Tabs.Screen name="Account" component={AccountScreen} />
    </Tabs.Navigator>
  );
}

function Root() {
  const { user, isHydrating, hydrate } = useAuthStore();
  const [startupTimedOut, setStartupTimedOut] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setStartupTimedOut(true), 8000);
    hydrate();
    return () => clearTimeout(timer);
  }, [hydrate]);

  if (isHydrating) {
    return (
      <View style={styles.loading}>
        <AppText variant="caption">OXSTEED MOBILE</AppText>
        <ActivityIndicator color={colors.orange} />
        <AppText variant="muted">
          {startupTimedOut ? "Still starting. Checking your saved session..." : "Starting your native app..."}
        </AppText>
      </View>
    );
  }

  return (
    <NavigationContainer theme={navTheme} linking={linking}>
      {user ? <SignedInTabs /> : <AuthScreen />}
    </NavigationContainer>
  );
}

export function OxSteedMobileApp() {
  return (
    <GestureHandlerRootView style={styles.appRoot}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="light" />
          <Root />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  appRoot: {
    flex: 1
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.background
  }
});
