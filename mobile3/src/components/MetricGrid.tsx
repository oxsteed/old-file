import { StyleSheet, View } from "react-native";
import { Card } from "./Card";
import { AppText } from "./Text";
import { spacing } from "../theme";

type Metric = {
  label: string;
  value: string | number;
};

export function MetricGrid({ metrics }: { metrics: Metric[] }) {
  return (
    <View style={styles.grid}>
      {metrics.map((metric) => (
        <Card key={metric.label} style={styles.metric}>
          <AppText variant="title">{metric.value}</AppText>
          <AppText variant="caption">{metric.label}</AppText>
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  metric: {
    flexBasis: "48%",
    flexGrow: 1
  }
});
