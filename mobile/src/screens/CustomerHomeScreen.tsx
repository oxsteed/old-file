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
import { useI18n } from "../i18n";
import { colors, spacing } from "../theme";
import { addAppointmentToDeviceCalendar, addBookingToDeviceCalendar } from "../utils/deviceCalendar";

function bookingName(booking: MobileBooking) {
  return booking.serviceName || booking.service_name;
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
  const { t } = useI18n();
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
      Alert.alert(t("customer.reviewSent"), t("customer.reviewSentBody"));
      await queryClient.invalidateQueries({ queryKey: ["mobile-feed"] });
    },
    onError: (error) => Alert.alert(t("customer.reviewFailed"), error instanceof OxSteedApiError || error instanceof Error ? error.message : t("common.retry"))
  });

  const requestReschedule = useMutation({
    mutationFn: ({ appointment, start, end, message }: { appointment: MobileAppointment; start: string; end: string; message: string }) =>
      api.requestAppointmentReschedule(appointment.id, {
        proposed_start: new Date(start).toISOString(),
        proposed_end: new Date(end).toISOString(),
        message
      }),
    onSuccess: async () => {
      Alert.alert(t("customer.reschedule.sent"), t("customer.reschedule.sentBody"));
      await queryClient.invalidateQueries({ queryKey: ["mobile-feed"] });
    },
    onError: (error) => Alert.alert(t("customer.reschedule.failed"), error instanceof Error ? error.message : t("common.retry"))
  });

  if (feed.isLoading) {
    return (
      <Screen scroll={false}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.orange} />
          <AppText variant="muted">{t("customer.loading")}</AppText>
        </View>
      </Screen>
    );
  }

  if (feed.isError || !feed.data) {
    return (
      <Screen>
        <Card>
          <AppText variant="headline">{t("customer.errorTitle")}</AppText>
          <AppText variant="muted">{t("customer.errorBody")}</AppText>
          <Button onPress={() => feed.refetch()}>{t("common.retry")}</Button>
        </Card>
      </Screen>
    );
  }

  const data = feed.data;

  return (
    <Screen>
      <View>
        <AppText variant="caption">{t("customer.caption")}</AppText>
        <AppText variant="title">{t("customer.title")}</AppText>
      </View>

      <MetricGrid
        metrics={[
          { label: t("customer.metrics.openJobs"), value: data.summary.open_jobs },
          { label: t("customer.metrics.unread"), value: data.summary.unread_messages },
          { label: t("customer.metrics.bookings"), value: data.bookings.sent.length },
          { label: t("customer.metrics.plans"), value: data.planned_needs.length }
        ]}
      />

      <Card>
        <AppText variant="headline">{t("customer.jobs")}</AppText>
        {data.jobs.mine.length === 0 ? (
          <AppText variant="muted">{t("customer.jobs.empty")}</AppText>
        ) : (
          data.jobs.mine.map((job) => (
            <View key={job.id} style={styles.row}>
              <AppText>{job.title}</AppText>
              <AppText variant="caption">{job.status || "open"}</AppText>
              {isCompletedJob(job) && (
                <View style={styles.reviewBox}>
                  <FormInput
                    placeholder={t("customer.reviewRating")}
                    keyboardType="number-pad"
                    value={reviewDrafts[job.id]?.rating || ""}
                    onChangeText={(rating) => setReviewDrafts((drafts) => ({ ...drafts, [job.id]: { rating, body: drafts[job.id]?.body || "" } }))}
                  />
                  <FormInput
                    placeholder={t("customer.reviewBody")}
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
                    {t("customer.leaveReview")}
                  </Button>
                </View>
              )}
            </View>
          ))
        )}
      </Card>

      <Card>
        <AppText variant="headline">{t("customer.booking.title")}</AppText>
        {data.bookings.sent.length === 0 ? (
          <AppText variant="muted">{t("customer.booking.empty")}</AppText>
        ) : (
          data.bookings.sent.map((booking) => (
            <View key={booking.id} style={styles.row}>
              <AppText>{bookingName(booking) || t("customer.status.bookingRequest")}</AppText>
              <AppText variant="caption">{[bookingDate(booking), bookingStatus(booking), booking.paymentStatus || booking.payment_status].filter(Boolean).join(" - ")}</AppText>
              {bookingStatus(booking) === "accepted" && (
                <Button
                  variant="secondary"
                  onPress={async () => {
                    try {
                      await addBookingToDeviceCalendar(booking);
                      Alert.alert(t("customer.calendar.added"), t("customer.calendar.bookingAdded"));
                    } catch (error) {
                      Alert.alert(t("customer.calendar.failed"), error instanceof Error ? error.message : t("common.retry"));
                    }
                  }}
                >
                  {t("customer.calendar.add")}
                </Button>
              )}
            </View>
          ))
        )}
      </Card>

      <Card>
        <AppText variant="headline">{t("customer.appointments.title")}</AppText>
        {data.appointments.length === 0 ? (
          <AppText variant="muted">{t("customer.appointments.empty")}</AppText>
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
                      Alert.alert(t("customer.calendar.added"), t("customer.calendar.appointmentAdded"));
                    } catch (error) {
                      Alert.alert(t("customer.calendar.failed"), error instanceof Error ? error.message : t("common.retry"));
                    }
                  }}
                >
                  {t("customer.calendar.add")}
                </Button>
                <FormInput
                  placeholder={t("customer.reschedule.start")}
                  value={draft.start}
                  onChangeText={(start) => setRescheduleDrafts((drafts) => ({ ...drafts, [appointment.id]: { ...draft, start } }))}
                />
                <FormInput
                  placeholder={t("customer.reschedule.end")}
                  value={draft.end}
                  onChangeText={(end) => setRescheduleDrafts((drafts) => ({ ...drafts, [appointment.id]: { ...draft, end } }))}
                />
                <FormInput
                  placeholder={t("customer.reschedule.message")}
                  value={draft.message}
                  onChangeText={(message) => setRescheduleDrafts((drafts) => ({ ...drafts, [appointment.id]: { ...draft, message } }))}
                />
                <Button
                  disabled={!draft.start || !draft.end || requestReschedule.isPending}
                  onPress={() => requestReschedule.mutate({ appointment, start: draft.start, end: draft.end, message: draft.message })}
                >
                  {t("customer.reschedule.button")}
                </Button>
              </View>
            );
          })
        )}
      </Card>

      <Card>
        <AppText variant="headline">{t("customer.plans.title")}</AppText>
        {data.planned_needs.length === 0 ? (
          <AppText variant="muted">{t("customer.plans.empty")}</AppText>
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
