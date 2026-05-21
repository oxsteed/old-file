import { useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { BusinessHubLiteScreen } from "./BusinessHubLiteScreen";
import { HelperHomeScreen } from "./HelperHomeScreen";
import { MessagesScreen } from "./MessagesScreen";
import { PaymentsScreen } from "./PaymentsScreen";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Screen } from "../components/Screen";
import { AppText } from "../components/Text";
import { WorkspaceTabs } from "../components/WorkspaceTabs";
import { useI18n } from "../i18n";
import { spacing } from "../theme";

type ProWorkspace = "overview" | "business" | "helper" | "messages" | "payments";

export function ProModeScreen() {
  const { t } = useI18n();
  const [workspace, setWorkspace] = useState<ProWorkspace>("overview");

  if (workspace === "business") return <WorkspaceFrame current={workspace} onChange={setWorkspace}><BusinessHubLiteScreen /></WorkspaceFrame>;
  if (workspace === "helper") return <WorkspaceFrame current={workspace} onChange={setWorkspace}><HelperHomeScreen /></WorkspaceFrame>;
  if (workspace === "messages") return <WorkspaceFrame current={workspace} onChange={setWorkspace}><MessagesScreen /></WorkspaceFrame>;
  if (workspace === "payments") return <WorkspaceFrame current={workspace} onChange={setWorkspace}><PaymentsScreen /></WorkspaceFrame>;

  return (
    <Screen>
      <View>
        <AppText variant="caption">{t("pro.caption")}</AppText>
        <AppText variant="title">{t("pro.title")}</AppText>
        <AppText variant="muted">{t("pro.subtitle")}</AppText>
      </View>

      <Card>
        <AppText variant="headline">{t("pro.quick.businessTitle")}</AppText>
        <AppText variant="muted">{t("pro.quick.businessBody")}</AppText>
        <Button onPress={() => setWorkspace("business")}>{t("pro.quick.businessButton")}</Button>
      </Card>

      <Card>
        <AppText variant="headline">{t("pro.quick.helperTitle")}</AppText>
        <AppText variant="muted">{t("pro.quick.helperBody")}</AppText>
        <Button onPress={() => setWorkspace("helper")}>{t("pro.quick.helperButton")}</Button>
      </Card>

      <Card>
        <AppText variant="headline">{t("pro.quick.paymentsTitle")}</AppText>
        <AppText variant="muted">{t("pro.quick.paymentsBody")}</AppText>
        <Button onPress={() => setWorkspace("payments")}>{t("pro.quick.paymentsButton")}</Button>
      </Card>

      <Card>
        <AppText variant="headline">{t("pro.connected.title")}</AppText>
        <AppText>{t("pro.connected.home")}</AppText>
        <AppText>{t("pro.connected.learn")}</AppText>
        <AppText>{t("pro.connected.tools")}</AppText>
      </Card>
    </Screen>
  );
}

function WorkspaceFrame({
  children,
  current,
  onChange
}: {
  children: ReactNode;
  current: ProWorkspace;
  onChange: (workspace: ProWorkspace) => void;
}) {
  const { t } = useI18n();

  return (
    <View style={styles.frame}>
      <WorkspaceTabs value={current} options={proOptions(t)} onChange={onChange} />
      <View style={styles.body}>{children}</View>
    </View>
  );
}

function proOptions(t: (key: string) => string) {
  return [
    { key: "overview", label: t("pro.workspace.overview") },
    { key: "business", label: t("pro.workspace.business") },
    { key: "helper", label: t("pro.workspace.helper") },
    { key: "messages", label: t("pro.workspace.messages") },
    { key: "payments", label: t("pro.workspace.payments") }
  ] as Array<{ key: ProWorkspace; label: string }>;
}

const styles = StyleSheet.create({
  frame: {
    flex: 1
  },
  body: {
    flex: 1
  }
});
