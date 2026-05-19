import { useQuery } from "@tanstack/react-query";
import { StyleSheet, View } from "react-native";
import { api } from "../api/client";
import { Card } from "../components/Card";
import { MetricGrid } from "../components/MetricGrid";
import { Screen } from "../components/Screen";
import { AppText } from "../components/Text";
import { colors, spacing } from "../theme";

export function HelperHomeScreen() {
  const feed = useQuery({
    queryKey: ["mobile-feed"],
    queryFn: api.mobileFeed
  });

  const data = feed.data;

  return (
    <Screen>
      <View>
        <AppText variant="caption">HELPER WORK CENTER</AppText>
        <AppText variant="title">Find work, respond fast, and keep schedule control.</AppText>
      </View>

      <MetricGrid
        metrics={[
          { label: "Incoming bookings", value: data?.summary.incoming_booking_requests ?? 0 },
          { label: "Unread messages", value: data?.summary.unread_messages ?? 0 },
          { label: "Available jobs", value: data?.jobs.available.length ?? 0 },
          { label: "Appointments", value: data?.appointments.length ?? 0 }
        ]}
      />

      <Card>
        <AppText variant="headline">Incoming booking requests</AppText>
        {!data || data.bookings.incoming.length === 0 ? (
          <AppText variant="muted">Direct booking requests will appear here with accept/decline in Phase 3.</AppText>
        ) : (
          data.bookings.incoming.map((booking) => (
            <View key={booking.id} style={styles.row}>
              <AppText>{booking.service_name || "Booking request"}</AppText>
              <AppText variant="caption">{[booking.customer_name, booking.requested_date, booking.status].filter(Boolean).join(" - ")}</AppText>
            </View>
          ))
        )}
      </Card>

      <Card>
        <AppText variant="headline">Available job feed</AppText>
        {!data || data.jobs.available.length === 0 ? (
          <AppText variant="muted">Open local jobs will appear here once available.</AppText>
        ) : (
          data.jobs.available.map((job) => (
            <View key={job.id} style={styles.row}>
              <AppText>{job.title}</AppText>
              <AppText variant="caption">{[job.category_name, job.location_city, job.status].filter(Boolean).join(" - ")}</AppText>
            </View>
          ))
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border
  }
});
