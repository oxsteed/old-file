import type { PropsWithChildren } from "react";
import { Pressable, StyleSheet, ViewStyle } from "react-native";
import { AppText } from "./Text";
import { colors, radius, spacing } from "../theme";

type ButtonProps = PropsWithChildren<{
  onPress: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
  style?: ViewStyle;
}>;

export function Button({ children, onPress, disabled, variant = "primary", style }: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        style
      ]}
    >
      <AppText style={styles.label}>{children}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md
  },
  primary: {
    backgroundColor: colors.orange
  },
  secondary: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panelSoft
  },
  danger: {
    backgroundColor: colors.red
  },
  disabled: {
    opacity: 0.45
  },
  pressed: {
    opacity: 0.82
  },
  label: {
    fontWeight: "700"
  }
});
