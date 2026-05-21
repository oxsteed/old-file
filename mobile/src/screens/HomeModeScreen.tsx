import { useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { BrowseHelpersScreen } from "./BrowseHelpersScreen";
import { CustomerHomeScreen } from "./CustomerHomeScreen";
import { MessagesScreen } from "./MessagesScreen";
import { PaymentsScreen } from "./PaymentsScreen";
import { PlannedNeedsScreen } from "./PlannedNeedsScreen";
import { PostJobScreen } from "./PostJobScreen";
import { TrustSafetyScreen } from "./TrustSafetyScreen";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Screen } from "../components/Screen";
import { AppText } from "../components/Text";
import { WorkspaceTabs } from "../components/WorkspaceTabs";
import { useI18n } from "../i18n";
import { spacing } from "../theme";

type HomeWorkspace = "overview" | "dashboard" | "post" | "helpers" | "messages" | "plans" | "payments" | "trust";

export function HomeModeScreen() {
  const { t } = useI18n();
  const [workspace, setWorkspace] = useState<HomeWorkspace>("overview");

  if (workspace === "dashboard") return <WorkspaceFrame current={workspace} onChange={setWorkspace}><CustomerHomeScreen /></WorkspaceFrame>;
  if (workspace === "post") return <WorkspaceFrame current={workspace} onChange={setWorkspace}><PostJobScreen /></WorkspaceFrame>;
  if (workspace === "helpers") return <WorkspaceFrame current={workspace} onChange={setWorkspace}><BrowseHelpersScreen /></WorkspaceFrame>;
  if (workspace === "messages") return <WorkspaceFrame current={workspace} onChange={setWorkspace}><MessagesScreen /></WorkspaceFrame>;
  if (workspace === "plans") return <WorkspaceFrame current={workspace} onChange={setWorkspace}><PlannedNeedsScreen /></WorkspaceFrame>;
  if (workspace === "payments") return <WorkspaceFrame current={workspace} onChange={setWorkspace}><PaymentsScreen /></WorkspaceFrame>;
  if (workspace === "trust") return <WorkspaceFrame current={workspace} onChange={setWorkspace}><TrustSafetyScreen /></WorkspaceFrame>;

  return (
    <Screen>
      <View>
        <AppText variant="caption">{t("home.caption")}</AppText>
        <AppText variant="title">{t("home.title")}</AppText>
        <AppText variant="muted">{t("home.subtitle")}</AppText>
      </View>

      <Card>
        <AppText variant="headline">{t("home.quick.postTitle")}</AppText>
        <AppText variant="muted">{t("home.quick.postBody")}</AppText>
        <Button onPress={() => setWorkspace("post")}>{t("home.quick.postButton")}</Button>
      </Card>

      <Card>
        <AppText variant="headline">{t("home.quick.hireTitle")}</AppText>
        <AppText variant="muted">{t("home.quick.hireBody")}</AppText>
        <Button onPress={() => setWorkspace("helpers")}>{t("home.quick.hireButton")}</Button>
      </Card>

      <Card>
        <AppText variant="headline">{t("home.quick.messagesTitle")}</AppText>
        <AppText variant="muted">{t("home.quick.messagesBody")}</AppText>
        <Button onPress={() => setWorkspace("messages")}>{t("home.quick.messagesButton")}</Button>
      </Card>

      <Card>
        <AppText variant="headline">{t("home.connected.title")}</AppText>
        <AppText>{t("home.connected.learn")}</AppText>
        <AppText>{t("home.connected.tools")}</AppText>
        <AppText>{t("home.connected.pro")}</AppText>
      </Card>

      <Card>
        <AppText variant="headline">{t("common.openWorkspace")}</AppText>
        <View style={styles.grid}>
          {homeOptions(t).filter((option) => option.key !== "overview").map((option) => (
            <Button key={option.key} variant="secondary" style={styles.button} onPress={() => setWorkspace(option.key)}>
              {option.label}
            </Button>
          ))}
        </View>
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
  current: HomeWorkspace;
  onChange: (workspace: HomeWorkspace) => void;
}) {
  const { t } = useI18n();

  return (
    <View style={styles.frame}>
      <WorkspaceTabs value={current} options={homeOptions(t)} onChange={onChange} />
      <View style={styles.body}>{children}</View>
    </View>
  );
}

function homeOptions(t: (key: string) => string) {
  return [
    { key: "overview", label: t("home.workspace.overview") },
    { key: "dashboard", label: t("home.workspace.dashboard") },
    { key: "post", label: t("home.workspace.post") },
    { key: "helpers", label: t("home.workspace.helpers") },
    { key: "messages", label: t("home.workspace.messages") },
    { key: "plans", label: t("home.workspace.plans") },
    { key: "payments", label: t("home.workspace.payments") },
    { key: "trust", label: t("home.workspace.trust") }
  ] as Array<{ key: HomeWorkspace; label: string }>;
}

const styles = StyleSheet.create({
  frame: {
    flex: 1
  },
  body: {
    flex: 1
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  button: {
    flexBasis: "48%"
  }
});
