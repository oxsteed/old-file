import { useEffect } from "react";
import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { api } from "../api/client";
import { isEnabled } from "../config/featureFlags";
import { useAuthStore } from "../state/authStore";

let notificationHandlerConfigured = false;

export function usePushRegistration() {
  const user = useAuthStore((state) => state.user);

  useEffect(() => {
    if (!notificationHandlerConfigured) {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: false,
          shouldSetBadge: true
        })
      });
      notificationHandlerConfigured = true;
    }
  }, []);

  useEffect(() => {
    if (!user || !isEnabled("pushRegistration") || Platform.OS === "web") return;

    let cancelled = false;
    async function register() {
      if (!Device.isDevice) return;
      const current = await Notifications.getPermissionsAsync();
      const finalStatus =
        current.status === "granted"
          ? current.status
          : (await Notifications.requestPermissionsAsync()).status;
      if (finalStatus !== "granted" || cancelled) return;

      const token = await Notifications.getDevicePushTokenAsync();
      const platform = Platform.OS === "ios" ? "ios" : "android";
      await api.registerPushToken({
        token: token.data,
        provider: Platform.OS === "ios" ? "apns" : "fcm",
        platform,
        app_version: Constants.expoConfig?.version,
        device: {
          brand: Device.brand,
          modelName: Device.modelName,
          osName: Device.osName,
          osVersion: Device.osVersion
        }
      });
    }

    register().catch((error) => {
      if (__DEV__) console.warn("Push registration failed", error);
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user || Platform.OS === "web") return;
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      if (__DEV__) {
        console.info("Notification opened", response.notification.request.content.data);
      }
    });
    return () => subscription.remove();
  }, [user]);
}
