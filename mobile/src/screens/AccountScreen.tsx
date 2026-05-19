import { StyleSheet, View } from "react-native";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Screen } from "../components/Screen";
import { AppText } from "../components/Text";
import { useAuthStore } from "../state/authStore";
import { colors, spacing } from "../theme";

export function AccountScreen() {
  const { user, error, isWorking, switchRole, resendVerification, signOut } = useAuthStore();

  if (!user) return null;

  const canSwitchToHelper = user.role === "customer";
  const canSwitchToCustomer = ["helper", "helper_pro", "broker"].includes(user.role ?? "");

  return (
    <Screen>
      <View>
        <AppText variant="caption">ACCOUNT</AppText>
        <AppText variant="title">{[user.first_name, user.last_name].filter(Boolean).join(" ") || user.email}</AppText>
        <AppText variant="muted">{[user.email, user.role].filter(Boolean).join(" - ")}</AppText>
      </View>

      <Card>
        <AppText variant="headline">Mode switching</AppText>
        <AppText variant="muted">
          Phase 1 keeps customer and helper modes in one signed-in shell so the app can
          grow toward both sides of the marketplace without duplicate accounts.
        </AppText>
        {canSwitchToHelper && (
          <Button disabled={isWorking} onPress={() => switchRole("helper")}>
            Switch to helper mode
          </Button>
        )}
        {canSwitchToCustomer && (
          <Button disabled={isWorking} onPress={() => switchRole("customer")}>
            Switch to customer mode
          </Button>
        )}
      </Card>

      <Card>
        <AppText variant="headline">Verification</AppText>
        <AppText variant="muted">
          Email: {user.email_verified ? "verified" : "not verified"}
        </AppText>
        {!user.email_verified && (
          <Button variant="secondary" disabled={isWorking} onPress={resendVerification}>
            Resend verification email
          </Button>
        )}
      </Card>

      {error && <AppText style={styles.status}>{error}</AppText>}

      <Button variant="danger" onPress={signOut}>
        Sign out
      </Button>
    </Screen>
  );
}

const styles = StyleSheet.create({
  status: {
    color: colors.orange,
    marginTop: spacing.sm
  }
});
