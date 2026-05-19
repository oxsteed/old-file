import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from "react-native";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Screen } from "../components/Screen";
import { AppText } from "../components/Text";
import { useAuthStore } from "../state/authStore";
import { colors, radius, spacing } from "../theme";

export function AuthScreen() {
  const [mode, setMode] = useState<"login" | "register" | "forgot" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreementName, setAgreementName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<"customer" | "helper">("customer");
  const [mfaCode, setMfaCode] = useState("");
  const [useBackupCode, setUseBackupCode] = useState(false);

  const {
    error,
    isWorking,
    pendingMfaToken,
    login,
    register,
    forgotPassword,
    resetPassword,
    completeTwoFactor
  } = useAuthStore();

  const canLogin = Boolean(email.trim() && password && agreementName.trim());
  const canRegister = Boolean(firstName.trim() && lastName.trim() && email.trim() && password.length >= 8);
  const canRequestReset = Boolean(email.trim());
  const canResetPassword = Boolean(resetToken.trim() && password.length >= 8 && password === confirmPassword);

  async function submit() {
    if (mode === "login") {
      await login(email, password, agreementName);
      return;
    }
    if (mode === "forgot") {
      await forgotPassword(email);
      setMode("reset");
      return;
    }
    if (mode === "reset") {
      await resetPassword(resetToken, password);
      return;
    }
    await register({
      email: email.trim().toLowerCase(),
      password,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      phone: phone.trim() || undefined,
      role,
      language: "en"
    });
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <AppText variant="caption">OXSTEED MOBILE</AppText>
          <AppText variant="title">Sign in to move work, money, and schedules.</AppText>
          <AppText variant="muted">
            Phase 1 focuses on a real authenticated shell: customer mode, helper mode,
            push readiness, token refresh, and two-factor login.
          </AppText>
        </View>

        <Card>
          <View style={styles.segment}>
            <Button variant={mode === "login" ? "primary" : "secondary"} onPress={() => setMode("login")}>
              Sign in
            </Button>
            <Button variant={mode === "register" ? "primary" : "secondary"} onPress={() => setMode("register")}>
              Register
            </Button>
            <Button variant={mode === "forgot" || mode === "reset" ? "primary" : "secondary"} onPress={() => setMode("forgot")}>
              Reset
            </Button>
          </View>

          {mode === "register" && (
            <>
              <TextInput style={styles.input} placeholder="First name" placeholderTextColor={colors.muted} value={firstName} onChangeText={setFirstName} />
              <TextInput style={styles.input} placeholder="Last name" placeholderTextColor={colors.muted} value={lastName} onChangeText={setLastName} />
              <TextInput style={styles.input} placeholder="Phone optional" placeholderTextColor={colors.muted} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
              <View style={styles.segment}>
                <Button variant={role === "customer" ? "primary" : "secondary"} onPress={() => setRole("customer")}>Customer</Button>
                <Button variant={role === "helper" ? "primary" : "secondary"} onPress={() => setRole("helper")}>Helper</Button>
              </View>
            </>
          )}

          {mode !== "reset" && (
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={colors.muted}
              value={email}
              onChangeText={setEmail}
            />
          )}

          {mode !== "forgot" && (
            <TextInput
              secureTextEntry
              style={styles.input}
              placeholder={mode === "reset" ? "New password" : "Password"}
              placeholderTextColor={colors.muted}
              value={password}
              onChangeText={setPassword}
            />
          )}

          {mode === "login" && (
            <>
              <TextInput
                style={styles.input}
                placeholder="Full name agreement signature"
                placeholderTextColor={colors.muted}
                value={agreementName}
                onChangeText={setAgreementName}
              />
              <AppText variant="caption">
                OxSteed web sign-in requires a typed Terms and Privacy signature. The mobile
                app sends the same agreement fields to the backend.
              </AppText>
            </>
          )}

          {mode === "forgot" && (
            <AppText variant="caption">
              We will send the same secure reset link used by the OxSteed website.
            </AppText>
          )}

          {mode === "reset" && (
            <>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
                placeholder="Reset token from email link"
                placeholderTextColor={colors.muted}
                value={resetToken}
                onChangeText={setResetToken}
              />
              <TextInput
                secureTextEntry
                style={styles.input}
                placeholder="Confirm new password"
                placeholderTextColor={colors.muted}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
              />
              <Button variant="secondary" onPress={() => setMode("forgot")}>
                Send another reset email
              </Button>
            </>
          )}

          {Boolean(error) && <AppText style={styles.error}>{error}</AppText>}

          {pendingMfaToken ? (
            <View style={styles.mfaBox}>
              <TextInput
                style={styles.input}
                placeholder={useBackupCode ? "Backup code" : "Two-factor code"}
                placeholderTextColor={colors.muted}
                value={mfaCode}
                onChangeText={setMfaCode}
                keyboardType={useBackupCode ? "default" : "number-pad"}
              />
              <Button variant="secondary" onPress={() => setUseBackupCode((value) => !value)}>
                {useBackupCode ? "Use authenticator code" : "Use backup code"}
              </Button>
              <Button disabled={isWorking || !mfaCode.trim()} onPress={() => completeTwoFactor(mfaCode, useBackupCode)}>
                Verify code
              </Button>
            </View>
          ) : (
            <Button
              disabled={
                isWorking ||
                (mode === "login" && !canLogin) ||
                (mode === "register" && !canRegister) ||
                (mode === "forgot" && !canRequestReset) ||
                (mode === "reset" && !canResetPassword)
              }
              onPress={submit}
            >
              {isWorking
                ? "Working..."
                : mode === "login"
                  ? "Sign in"
                  : mode === "register"
                    ? "Create account"
                    : mode === "forgot"
                      ? "Send reset email"
                      : "Reset password"}
            </Button>
          )}
        </Card>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.sm,
    marginBottom: spacing.lg
  },
  segment: {
    flexDirection: "row",
    gap: spacing.sm
  },
  input: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    color: colors.text,
    backgroundColor: colors.background
  },
  error: {
    color: colors.red
  },
  mfaBox: {
    gap: spacing.sm
  }
});
