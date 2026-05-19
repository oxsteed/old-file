import { useQuery } from "@tanstack/react-query";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { api } from "../api/client";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { MetricGrid } from "../components/MetricGrid";
import { Screen } from "../components/Screen";
import { AppText } from "../components/Text";
import { colors, spacing } from "../theme";

export function CustomerHomeScreen() {
  const feed = useQuery({
    queryKey: ["mobile-feed"],
    queryFn: api.mobileFeed
  });

  if (feed.isLoading) {
    return (
      <Screen scroll={false}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.orange} />
          <AppText variant="muted">Loading your OxSteed command center...</AppText>
        </View>
      </Screen>
    );
  }

  if (feed.isError || !feed.data) {
    return (
      <Screen>
        <Card>
          <AppText variant="headline">Could not load dashboard</AppText>
          <AppText variant="muted">Pull this screen again after checking your connection.</AppText>
          <Button onPress={() => feed.refetch()}>Retry</Button>
        </Card>
      </Screen>
    );
  }

  const data = feed.data;

  return (
    <Screen>
      <View>
        <AppText variant="caption">CUSTOMER COMMAND CENTER</AppText>
        <AppText variant="title">Get work posted, booked, and paid.</AppText>
      </View>

      <MetricGrid
        metrics={[
          { label: "Open jobs", value: data.summary.open_jobs },
          { label: "Unread messages", value: data.summary.unread_messages },
          { label: "Upcoming bookings", value: data.bookings.sent.length },
          { label: "Planned needs", value: data.planned_needs.length }
        ]}
      />

      <Card>
        <AppText variant="headline">My recent jobs</AppText>
        {data.jobs.mine.length === 0 ? (
          <AppText variant="muted">No jobs posted yet. Phase 2 expands this into the full multi-step job wizard.</AppText>
        ) : (
          data.jobs.mine.map((job) => (
            <View key={job.id} style={styles.row}>
              <AppText>{job.title}</AppText>
              <AppText variant="caption">{job.status || "open"}</AppText>
            </View>
          ))
        )}
      </Card>

      <Card>
        <AppText variant="headline">Upcoming bookings</AppText>
        {data.bookings.sent.length === 0 ? (
          <AppText variant="muted">No direct booking requests yet.</AppText>
        ) : (
          data.bookings.sent.map((booking) => (
            <View key={booking.id} style={styles.row}>
              <AppText>{booking.service_name || "Booking request"}</AppText>
              <AppText variant="caption">{[booking.requested_date, booking.status].filter(Boolean).join(" - ")}</AppText>
            </View>
          ))
        )}
      </Card>

      <Card>
        <AppText variant="headline">Planned needs</AppText>
        {data.planned_needs.length === 0 ? (
          <AppText variant="muted">Future needs will appear here once planned-needs mobile creation lands in Phase 2.</AppText>
        ) : (
          data.planned_needs.map((need) => (
            <View key={need.id} style={styles.row}>
              <AppText>{need.title}</AppText>
              <AppText variant="caption">{[need.due_date, need.status].filter(Boolean).join(" - ")}</AppText>
            </View>
          ))
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md
  },
  row: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border
  }
});
