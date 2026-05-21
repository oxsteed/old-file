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
import { HomeModeScreen } from "../screens/HomeModeScreen";
import { LearnModeScreen } from "../screens/LearnModeScreen";
import { ProModeScreen } from "../screens/ProModeScreen";
import { ToolRentalsScreen } from "../screens/ToolRentalsScreen";
import { AppText } from "../components/Text";
import { MobileI18nProvider, useI18n } from "../i18n";
import { useAppPreferencesStore } from "../state/appPreferencesStore";
import { useAuthStore } from "../state/authStore";
import { colors, spacing } from "../theme";
import { usePushRegistration } from "./usePushRegistration";

type RootTabs = {
  Home: undefined;
  Learn: undefined;
  Tools: undefined;
  Pro: undefined;
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
  const { t } = useI18n();
  const enabledModes = useAppPreferencesStore((state) => state.enabledModes);

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
      {enabledModes.home && <Tabs.Screen name="Home" component={HomeModeScreen} options={{ title: t("nav.home") }} />}
      {enabledModes.learn && <Tabs.Screen name="Learn" component={LearnModeScreen} options={{ title: t("nav.learn") }} />}
      {enabledModes.tools && <Tabs.Screen name="Tools" component={ToolRentalsScreen} options={{ title: t("nav.tools") }} />}
      {enabledModes.pro && <Tabs.Screen name="Pro" component={ProModeScreen} options={{ title: t("nav.pro") }} />}
      <Tabs.Screen name="Account" component={AccountScreen} options={{ title: t("nav.account") }} />
    </Tabs.Navigator>
  );
}

function Root() {
  const { user, isHydrating, hydrate } = useAuthStore();
  const { isHydrating: isPrefsHydrating, hydrate: hydratePreferences } = useAppPreferencesStore();
  const { t } = useI18n();
  const [startupTimedOut, setStartupTimedOut] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setStartupTimedOut(true), 8000);
    hydrate();
    hydratePreferences();
    return () => clearTimeout(timer);
  }, [hydrate, hydratePreferences]);

  if (isHydrating || isPrefsHydrating) {
    return (
      <View style={styles.loading}>
        <AppText variant="caption">{t("app.loading.brand")}</AppText>
        <ActivityIndicator color={colors.orange} />
        <AppText variant="muted">
          {startupTimedOut ? t("app.loading.checkingSession") : t("app.loading.starting")}
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
          <MobileI18nProvider>
            <StatusBar style="light" />
            <Root />
          </MobileI18nProvider>
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
