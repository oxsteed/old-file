import { ScrollView, StyleSheet, View } from "react-native";
import { Button } from "./Button";
import { spacing } from "../theme";

type WorkspaceOption<T extends string> = {
  key: T;
  label: string;
};

type WorkspaceTabsProps<T extends string> = {
  value: T;
  options: Array<WorkspaceOption<T>>;
  onChange: (value: T) => void;
};

export function WorkspaceTabs<T extends string>({ value, options, onChange }: WorkspaceTabsProps<T>) {
  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {options.map((option) => (
          <Button
            key={option.key}
            variant={option.key === value ? "primary" : "secondary"}
            onPress={() => onChange(option.key)}
          >
            {option.label}
          </Button>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg
  },
  row: {
    gap: spacing.sm
  }
});
