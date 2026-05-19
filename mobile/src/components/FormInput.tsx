import { StyleSheet, TextInput, TextInputProps } from "react-native";
import { colors, radius, spacing } from "../theme";

export function FormInput(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={colors.muted}
      {...props}
      style={[styles.input, props.multiline && styles.multiline, props.style]}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    color: colors.text,
    backgroundColor: colors.background
  },
  multiline: {
    minHeight: 110,
    paddingTop: spacing.md,
    textAlignVertical: "top"
  }
});
