import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, View } from "react-native";
import { api, OxSteedApiError } from "../api/client";
import type { MobileAppointment, MobileBooking, MobileJob } from "../api/types";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { FormInput } from "../components/FormInput";
import { MetricGrid } from "../components/MetricGrid";
import { Screen } from "../components/Screen";
import { AppText } from "../components/Text";
import { colors, spacing } from "../theme";
import { addAppointmentToDeviceCalendar, addBookingToDeviceCalendar } from "../utils/deviceCalendar";

function bookingName(booking: MobileBooking) {
  return booking.serviceName || booking.service_name || "Booking request";
}

function bookingDate(booking: MobileBooking) {
  return booking.requestedDate || booking.requested_date;
}

function bookingStatus(booking: MobileBooking) {
  return booking.status || "pending";
}

function isCompletedJob(job: MobileJob) {
  return job.status === "completed" || job.status === "closed";
}

export function CustomerHomeScreen() {
  const queryClient = useQueryClient();
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, { rating: string; body: string }>>({});
  const [rescheduleDrafts, setRescheduleDrafts] = useState<Record<string, { start: string; end: string; message: string }>>({});

  const feed = useQuery({
    queryKey: ["mobile-feed"],
    queryFn: api.mobileFeed,
    refetchInterval: 20_000
  });

  const submitReview = useMutation({
    mutationFn: ({ job, rating, body }: { job: MobileJob; rating: number; body: string }) =>
      api.submitJobReview(job.id, { rating, body, title: "Mobile review" }),
    onSuccess: async () => {
      Alert.alert("Review sent", "Thanks for helping the next customer choose well.");
      await queryClient.invalidateQueries({ queryKey: ["mobile-feed"] });
    },
    onError: (error) => Alert.alert("Review not sent", error instanceof OxSteedApiError || error instanceof Error ? error.message : "Please try again.")
  });

  const requestReschedule = useMutation({
    mutationFn: ({ appointment, start, end, message }: { appointment: MobileAppointment; start: string; end: string; message: string }) =>
      api.requestAppointmentReschedule(appointment.id, {
        proposed_start: new Date(start).toISOString(),
        proposed_end: new Date(end).toISOString(),
        message
      }),
    onSuccess: async () => {
      Alert.alert("Reschedule requested", "The other party will be notified in OxSteed.");
      await queryClient.invalidateQueries({ queryKey: ["mobile-feed"] });
    },
    onError: (error) => Alert.alert("Reschedule failed", error instanceof Error ? error.message : "Please try again.")
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
              {isCompletedJob(job) && (
                <View style={styles.reviewBox}>
                  <FormInput
                    placeholder="Rating 1-5"
                    keyboardType="number-pad"
                    value={reviewDrafts[job.id]?.rating || ""}
                    onChangeText={(rating) => setReviewDrafts((drafts) => ({ ...drafts, [job.id]: { rating, body: drafts[job.id]?.body || "" } }))}
                  />
                  <FormInput
                    placeholder="What should others know?"
                    multiline
                    value={reviewDrafts[job.id]?.body || ""}
                    onChangeText={(body) => setReviewDrafts((drafts) => ({ ...drafts, [job.id]: { rating: drafts[job.id]?.rating || "5", body } }))}
                  />
                  <Button
                    variant="secondary"
                    disabled={submitReview.isPending}
                    onPress={() =>
                      submitReview.mutate({
                        job,
                        rating: Number(reviewDrafts[job.id]?.rating || 5),
                        body: reviewDrafts[job.id]?.body || "Great work."
                      })
                    }
                  >
                    Leave review
                  </Button>
                </View>
              )}
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
              <AppText>{bookingName(booking)}</AppText>
              <AppText variant="caption">{[bookingDate(booking), bookingStatus(booking), booking.paymentStatus || booking.payment_status].filter(Boolean).join(" - ")}</AppText>
              {bookingStatus(booking) === "accepted" && (
                <Button
                  variant="secondary"
                  onPress={async () => {
                    try {
                      await addBookingToDeviceCalendar(booking);
                      Alert.alert("Added to calendar", "This booking is now on your device calendar.");
                    } catch (error) {
                      Alert.alert("Calendar not updated", error instanceof Error ? error.message : "Please try again.");
                    }
                  }}
                >
                  Add to calendar
                </Button>
              )}
            </View>
          ))
        )}
      </Card>

      <Card>
        <AppText variant="headline">Appointments</AppText>
        {data.appointments.length === 0 ? (
          <AppText variant="muted">Accepted appointments will appear here with device-calendar and reschedule actions.</AppText>
        ) : (
          data.appointments.map((appointment) => {
            const draft = rescheduleDrafts[appointment.id] || { start: "", end: "", message: "" };
            return (
              <View key={appointment.id} style={styles.row}>
                <AppText>{appointment.job_title || appointment.title || "OxSteed appointment"}</AppText>
                <AppText variant="caption">{[appointment.scheduled_start_time, appointment.status].filter(Boolean).join(" - ")}</AppText>
                <Button
                  variant="secondary"
                  onPress={async () => {
                    try {
                      await addAppointmentToDeviceCalendar(appointment);
                      Alert.alert("Added to calendar", "This appointment is now on your device calendar.");
                    } catch (error) {
                      Alert.alert("Calendar not updated", error instanceof Error ? error.message : "Please try again.");
                    }
                  }}
                >
                  Add to calendar
                </Button>
                <FormInput
                  placeholder="New start, e.g. 2026-05-22 14:00"
                  value={draft.start}
                  onChangeText={(start) => setRescheduleDrafts((drafts) => ({ ...drafts, [appointment.id]: { ...draft, start } }))}
                />
                <FormInput
                  placeholder="New end"
                  value={draft.end}
                  onChangeText={(end) => setRescheduleDrafts((drafts) => ({ ...drafts, [appointment.id]: { ...draft, end } }))}
                />
                <FormInput
                  placeholder="Message"
                  value={draft.message}
                  onChangeText={(message) => setRescheduleDrafts((drafts) => ({ ...drafts, [appointment.id]: { ...draft, message } }))}
                />
                <Button
                  disabled={!draft.start || !draft.end || requestReschedule.isPending}
                  onPress={() => requestReschedule.mutate({ appointment, start: draft.start, end: draft.end, message: draft.message })}
                >
                  Request reschedule
                </Button>
              </View>
            );
          })
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
  },
  reviewBox: {
    gap: spacing.sm
  }
});
