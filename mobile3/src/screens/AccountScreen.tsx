import { StyleSheet, View } from "react-native";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Screen } from "../components/Screen";
import { AppText } from "../components/Text";
import { useI18n, mobileLanguages } from "../i18n";
import { useAppPreferencesStore, type AppMode } from "../state/appPreferencesStore";
import { useAuthStore } from "../state/authStore";
import { colors, spacing } from "../theme";

export function AccountScreen() {
  const { t, language, setLanguage } = useI18n();
  const enabledModes = useAppPreferencesStore((state) => state.enabledModes);
  const toggleMode = useAppPreferencesStore((state) => state.toggleMode);
  const { user, error, isWorking, switchRole, resendVerification, signOut } = useAuthStore();

  if (!user) return null;

  const canSwitchToHelper = user.role === "customer";
  const canSwitchToCustomer = ["helper", "helper_pro", "broker"].includes(user.role ?? "");
  const displayName = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email;
  const roleLabel = t(`roles.${user.role ?? "customer"}`);

  return (
    <Screen>
      <View>
        <AppText variant="caption">{t("account.caption")}</AppText>
        <AppText variant="title">{displayName}</AppText>
        <AppText variant="muted">{[user.email, roleLabel].filter(Boolean).join(" - ")}</AppText>
      </View>

      <Card>
        <AppText variant="headline">{t("account.modeSettings")}</AppText>
        <AppText variant="muted">{t("account.modeHelp")}</AppText>
        {([
          ["home", "account.mode.home", "account.mode.homeBody"],
          ["learn", "account.mode.learn", "account.mode.learnBody"],
          ["tools", "account.mode.tools", "account.mode.toolsBody"],
          ["pro", "account.mode.pro", "account.mode.proBody"]
        ] as Array<[AppMode, string, string]>).map(([mode, labelKey, bodyKey]) => (
          <View key={mode} style={styles.modeRow}>
            <View style={styles.modeCopy}>
              <AppText>{t(labelKey)}</AppText>
              <AppText variant="caption">{t(bodyKey)}</AppText>
            </View>
            <Button
              variant={enabledModes[mode] ? "primary" : "secondary"}
              style={styles.modeButton}
              onPress={async () => {
                const changed = await toggleMode(mode);
                if (!changed) return;
              }}
            >
              {enabledModes[mode] ? t("common.enabled") : t("common.disabled")}
            </Button>
          </View>
        ))}
        <AppText variant="caption">{t("account.keepOneMode")}</AppText>
      </Card>

      <Card>
        <AppText variant="headline">{t("account.languages")}</AppText>
        <View style={styles.languageGrid}>
          {mobileLanguages.map((option) => (
            <Button
              key={option.value}
              variant={language === option.value ? "primary" : "secondary"}
              style={styles.languageButton}
              onPress={() => setLanguage(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </View>
      </Card>

      <Card>
        <AppText variant="headline">{t("account.roleSwitch")}</AppText>
        <AppText variant="muted">{t("account.roleHelp")}</AppText>
        {canSwitchToHelper && (
          <Button disabled={isWorking} onPress={() => switchRole("helper")}>
            {t("account.switchToHelper")}
          </Button>
        )}
        {canSwitchToCustomer && (
          <Button disabled={isWorking} onPress={() => switchRole("customer")}>
            {t("account.switchToCustomer")}
          </Button>
        )}
      </Card>

      <Card>
        <AppText variant="headline">{t("account.verification")}</AppText>
        <AppText variant="muted">
          {user.email_verified ? t("account.emailVerified") : t("account.emailNotVerified")}
        </AppText>
        {!user.email_verified && (
          <Button variant="secondary" disabled={isWorking} onPress={resendVerification}>
            {t("account.resendVerification")}
          </Button>
        )}
      </Card>

      {error && <AppText style={styles.status}>{error}</AppText>}

      <Button variant="danger" onPress={signOut}>
        {t("account.signOut")}
      </Button>
    </Screen>
  );
}

const styles = StyleSheet.create({
  status: {
    color: colors.orange,
    marginTop: spacing.sm
  },
  modeRow: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center"
  },
  modeCopy: {
    flex: 1,
    gap: spacing.xs
  },
  modeButton: {
    minWidth: 110
  },
  languageGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  languageButton: {
    flexBasis: "48%"
  }
});
