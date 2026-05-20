import "react-native-gesture-handler";
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

export default Sentry.wrap(OxSteedMobileApp);
