import type { PropsWithChildren } from "react";
import { StyleSheet, Text as RNText, TextProps } from "react-native";
import { colors } from "../theme";

type AppTextProps = PropsWithChildren<TextProps> & {
  variant?: "title" | "headline" | "body" | "caption" | "muted";
};

export function AppText({ variant = "body", style, children, ...props }: AppTextProps) {
  return (
    <RNText {...props} style={[styles.base, styles[variant], style]}>
      {children}
    </RNText>
  );
}

const styles = StyleSheet.create({
  base: {
    color: colors.text
  },
  title: {
    fontSize: 30,
    fontWeight: "800",
    lineHeight: 36
  },
  headline: {
    fontSize: 18,
    fontWeight: "700"
  },
  body: {
    fontSize: 15,
    lineHeight: 22
  },
  caption: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17
  },
  muted: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20
  }
});
