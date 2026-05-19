import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { NavigationContainer, DarkTheme, Theme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { AccountScreen } from "../screens/AccountScreen";
import { AuthScreen } from "../screens/AuthScreen";
import { BrowseHelpersScreen } from "../screens/BrowseHelpersScreen";
import { CustomerHomeScreen } from "../screens/CustomerHomeScreen";
import { HelperHomeScreen } from "../screens/HelperHomeScreen";
import { MessagesScreen } from "../screens/MessagesScreen";
import { PaymentsScreen } from "../screens/PaymentsScreen";
import { PlannedNeedsScreen } from "../screens/PlannedNeedsScreen";
import { PostJobScreen } from "../screens/PostJobScreen";
import { isEnabled } from "../config/featureFlags";
import { useAuthStore } from "../state/authStore";
import { colors } from "../theme";
import { usePushRegistration } from "./usePushRegistration";

type RootTabs = {
  Customer: undefined;
  Post: undefined;
  Helpers: undefined;
  Messages: undefined;
  Plans: undefined;
  Payments: undefined;
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
      {isEnabled("helperDashboard") && <Tabs.Screen name="Helper" component={HelperHomeScreen} />}
      <Tabs.Screen name="Account" component={AccountScreen} />
    </Tabs.Navigator>
  );
}

function Root() {
  const { user, isHydrating, hydrate } = useAuthStore();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  if (isHydrating) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.orange} />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navTheme}>
      {user ? <SignedInTabs /> : <AuthScreen />}
    </NavigationContainer>
  );
}

export function OxSteedMobileApp() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="light" />
        <Root />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background
  }
});
