import { StyleSheet, View } from "react-native";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Screen } from "../components/Screen";
import { AppText } from "../components/Text";
import { useI18n } from "../i18n";
import { useAppPreferencesStore } from "../state/appPreferencesStore";
import { colors, spacing } from "../theme";

const lessons = [
  { key: "sink", minutes: 8, tools: ["Adjustable wrench", "Bucket", "New gasket"] },
  { key: "paint", minutes: 12, tools: ["Putty knife", "Patch compound", "Sand block"] },
  { key: "lawn", minutes: 6, tools: ["Edger", "Gloves", "Broom"] }
] as const;

export function LearnModeScreen() {
  const { t } = useI18n();
  const enabledModes = useAppPreferencesStore((state) => state.enabledModes);

  return (
    <Screen>
      <View>
        <AppText variant="caption">{t("learn.caption")}</AppText>
        <AppText variant="title">{t("learn.title")}</AppText>
        <AppText variant="muted">{t("learn.subtitle")}</AppText>
      </View>

      <Card>
        <AppText variant="headline">{t("learn.section.featured")}</AppText>
        {lessons.map((lesson) => (
          <View key={lesson.key} style={styles.lesson}>
            <AppText>{t(`learn.lesson.${lesson.key}.title`)}</AppText>
            <AppText variant="caption">{t("learn.minutes", { minutes: lesson.minutes })}</AppText>
            <AppText variant="muted">{t(`learn.lesson.${lesson.key}.body`)}</AppText>
            <AppText variant="caption">
              {t("learn.toolsNeeded")}: {lesson.tools.join(" • ")}
            </AppText>
          </View>
        ))}
      </Card>

      <Card>
        <AppText variant="headline">{t("learn.section.playbooks")}</AppText>
        <View style={styles.lesson}>
          <AppText>{t("learn.playbook.weekend.title")}</AppText>
          <AppText variant="muted">{t("learn.playbook.weekend.body")}</AppText>
        </View>
        <View style={styles.lesson}>
          <AppText>{t("learn.playbook.rental.title")}</AppText>
          <AppText variant="muted">{t("learn.playbook.rental.body")}</AppText>
        </View>
      </Card>

      <Card>
        <AppText variant="headline">{t("learn.section.connected")}</AppText>
        <View style={styles.connectedCard}>
          <AppText>{t("learn.connected.home.title")}</AppText>
          <AppText variant="muted">{t("learn.connected.home.body")}</AppText>
          <AppText variant="caption">{enabledModes.home ? `${t("learn.connected.buttonHome")} • ${t("common.enabled")}` : `${t("learn.connected.buttonHome")} • ${t("common.disabled")}`}</AppText>
        </View>
        <View style={styles.connectedCard}>
          <AppText>{t("learn.connected.tools.title")}</AppText>
          <AppText variant="muted">{t("learn.connected.tools.body")}</AppText>
          <AppText variant="caption">{enabledModes.tools ? `${t("learn.connected.buttonTools")} • ${t("common.enabled")}` : `${t("learn.connected.buttonTools")} • ${t("common.disabled")}`}</AppText>
        </View>
        <View style={styles.connectedCard}>
          <AppText>{t("learn.connected.pro.title")}</AppText>
          <AppText variant="muted">{t("learn.connected.pro.body")}</AppText>
          <AppText variant="caption">{enabledModes.pro ? `${t("learn.connected.buttonPro")} • ${t("common.enabled")}` : `${t("learn.connected.buttonPro")} • ${t("common.disabled")}`}</AppText>
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  lesson: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border
  },
  connectedCard: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border
  }
});
