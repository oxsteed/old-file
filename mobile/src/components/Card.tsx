import type { PropsWithChildren } from "react";
import { StyleSheet, View, ViewProps } from "react-native";
import { colors, radius, spacing } from "../theme";

export function Card({ children, style, ...props }: PropsWithChildren<ViewProps>) {
  return (
    <View {...props} style={[styles.card, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.panel
  }
});
