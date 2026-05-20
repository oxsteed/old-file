import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { useMemo, useState } from "react";
import { Alert, Image, Linking, Pressable, StyleSheet, View } from "react-native";
import { api, OxSteedApiError } from "../api/client";
import type { MobileBooking, MobileJob } from "../api/types";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { FormInput } from "../components/FormInput";
import { MetricGrid } from "../components/MetricGrid";
import { Screen } from "../components/Screen";
import { AppText } from "../components/Text";
import { colors, radius, spacing } from "../theme";

type HelperSection = "overview" | "jobs" | "calendar" | "profile" | "earnings";

const sections: Array<{ id: HelperSection; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "jobs", label: "Jobs" },
  { id: "calendar", label: "Calendar" },
  { id: "profile", label: "Profile" },
  { id: "earnings", label: "Earnings" }
];

function money(value?: string | number | null) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return "$0";
  return `$${parsed.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function errorMessage(error: unknown) {
  if (error instanceof OxSteedApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}

function bookingTitle(booking: MobileBooking) {
  return booking.serviceName || booking.service_name || "Booking request";
}

function bookingDate(booking: MobileBooking) {
  return booking.requestedDate || booking.requested_date || "Date pending";
}

function bookingTime(booking: MobileBooking) {
  return [booking.requestedStartTime || booking.requested_start_time, booking.requestedEndTime || booking.requested_end_time]
    .filter(Boolean)
    .join(" - ");
}

export function HelperHomeScreen() {
  const queryClient = useQueryClient();
  const [section, setSection] = useState<HelperSection>("overview");
  const [jobFilters, setJobFilters] = useState({ q: "", category: "", city: "", radius: "25", sort: "newest" });
  const [selectedJob, setSelectedJob] = useState<MobileJob | null>(null);
  const [bidDraft, setBidDraft] = useState({ amount: "", message: "", etaHours: "" });
  const [availabilityDraft, setAvailabilityDraft] = useState({
    start: "",
    end: "",
    title: "Unavailable",
    notes: ""
  });
  const [profileDraft, setProfileDraft] = useState({
    profile_headline: "",
    bio_short: "",
    service_city: "",
    service_state: "",
    service_radius_miles: "25"
  });
  const [serviceDraft, setServiceDraft] = useState({ name: "", price: "", duration: "", description: "" });
  const [policyDraft, setPolicyDraft] = useState({ title: "", content: "" });
  const [galleryCaption, setGalleryCaption] = useState("");

  const feed = useQuery({ queryKey: ["mobile-feed"], queryFn: api.mobileFeed });
  const jobs = useQuery({
    queryKey: ["helper-jobs", jobFilters],
    queryFn: () =>
      api.listJobs({
        q: jobFilters.q,
        category: jobFilters.category,
        city: jobFilters.city,
        radius: jobFilters.radius,
        sort: jobFilters.sort as "newest" | "urgent" | "budget_high" | "budget_low" | "nearest",
        limit: 25
      })
  });
  const bids = useQuery({ queryKey: ["helper-bids"], queryFn: () => api.listMyBids() });
  const incomingBookings = useQuery({ queryKey: ["helper-bookings"], queryFn: api.listIncomingBookings });
  const appointments = useQuery({ queryKey: ["helper-appointments"], queryFn: api.listAppointments });
  const availability = useQuery({ queryKey: ["helper-availability"], queryFn: api.listAvailabilityBlocks });
  const profile = useQuery({
    queryKey: ["helper-profile-me"],
    queryFn: async () => {
      const data = await api.helperProfileMe();
      setProfileDraft({
        profile_headline: data.profile_headline || "",
        bio_short: data.bio_short || "",
        service_city: data.service_city || "",
        service_state: data.service_state || "",
        service_radius_miles: String(data.service_radius_miles || "25")
      });
      return data;
    }
  });
  const payments = useQuery({ queryKey: ["helper-payments"], queryFn: api.listPayeePayments });
  const connect = useQuery({ queryKey: ["helper-connect"], queryFn: api.connectStatus });
  const qrCode = useQuery({
    queryKey: ["helper-qr", feed.data?.user.id],
    enabled: Boolean(feed.data?.user.id),
    queryFn: () => api.helperProfileQrCode(feed.data!.user.id)
  });

  const dashboardMetrics = useMemo(() => {
    const pendingBids = bids.data?.filter((bid) => bid.status === "pending").length ?? 0;
    const confirmedAppointments = appointments.data?.filter((appointment) => appointment.status === "confirmed").length ?? 0;
    const weekStart = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const weekEarnings =
      payments.data?.payments
        .filter((payment) => payment.status === "captured" && new Date(payment.created_at || 0).getTime() >= weekStart)
        .reduce((sum, payment) => sum + Number(payment.amount || 0), 0) ?? 0;
    return [
      { label: "Incoming bookings", value: incomingBookings.data?.length ?? feed.data?.summary.incoming_booking_requests ?? 0 },
      { label: "Unread messages", value: feed.data?.summary.unread_messages ?? 0 },
      { label: "Pending bids", value: pendingBids },
      { label: "Confirmed", value: confirmedAppointments },
      { label: "This week", value: money(weekEarnings) }
    ];
  }, [appointments.data, bids.data, feed.data, incomingBookings.data, payments.data]);

  const refreshHelper = () => {
    queryClient.invalidateQueries({ queryKey: ["mobile-feed"] });
    queryClient.invalidateQueries({ queryKey: ["helper-bids"] });
    queryClient.invalidateQueries({ queryKey: ["helper-bookings"] });
    queryClient.invalidateQueries({ queryKey: ["helper-appointments"] });
    queryClient.invalidateQueries({ queryKey: ["helper-availability"] });
    queryClient.invalidateQueries({ queryKey: ["helper-profile-me"] });
    queryClient.invalidateQueries({ queryKey: ["helper-payments"] });
    queryClient.invalidateQueries({ queryKey: ["helper-connect"] });
  };

  const submitBid = useMutation({
    mutationFn: () => {
      if (!selectedJob) throw new Error("Select a job first.");
      const amount = Number(bidDraft.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a valid bid amount.");
      return api.submitBid({
        job_id: selectedJob.id,
        amount,
        message: bidDraft.message || "I can help with this job.",
        eta_hours: bidDraft.etaHours ? Number(bidDraft.etaHours) : undefined
      });
    },
    onSuccess: () => {
      setBidDraft({ amount: "", message: "", etaHours: "" });
      setSelectedJob(null);
      refreshHelper();
      Alert.alert("Bid submitted", "Your quote is now visible to the customer.");
    },
    onError: (error) => Alert.alert("Bid not submitted", errorMessage(error))
  });

  const acceptBooking = useMutation({
    mutationFn: api.acceptBooking,
    onSuccess: () => refreshHelper(),
    onError: (error) => Alert.alert("Booking update failed", errorMessage(error))
  });

  const declineBooking = useMutation({
    mutationFn: (id: string | number) => api.declineBooking(id, "Not available for that time."),
    onSuccess: () => refreshHelper(),
    onError: (error) => Alert.alert("Booking update failed", errorMessage(error))
  });

  const blockTime = useMutation({
    mutationFn: () => {
      if (!availabilityDraft.start || !availabilityDraft.end) throw new Error("Add start and end times.");
      return api.createAvailabilityBlock({
        start_time: new Date(availabilityDraft.start).toISOString(),
        end_time: new Date(availabilityDraft.end).toISOString(),
        type: "unavailable",
        title: availabilityDraft.title,
        notes: availabilityDraft.notes
      });
    },
    onSuccess: () => {
      setAvailabilityDraft({ start: "", end: "", title: "Unavailable", notes: "" });
      refreshHelper();
    },
    onError: (error) => Alert.alert("Could not block time", errorMessage(error))
  });

  const saveProfile = useMutation({
    mutationFn: () => api.updateHelperProfileCore(profileDraft),
    onSuccess: () => refreshHelper(),
    onError: (error) => Alert.alert("Profile update failed", errorMessage(error))
  });

  const addService = useMutation({
    mutationFn: () =>
      api.addHelperService({
        name: serviceDraft.name,
        price: Number(serviceDraft.price || 0),
        duration: serviceDraft.duration,
        description: serviceDraft.description,
        price_unit: serviceDraft.price ? "starting_at" : "quote"
      }),
    onSuccess: () => {
      setServiceDraft({ name: "", price: "", duration: "", description: "" });
      refreshHelper();
    },
    onError: (error) => Alert.alert("Service not saved", errorMessage(error))
  });

  const addPolicy = useMutation({
    mutationFn: () => api.addHelperPolicy(policyDraft),
    onSuccess: () => {
      setPolicyDraft({ title: "", content: "" });
      refreshHelper();
    },
    onError: (error) => Alert.alert("Policy not saved", errorMessage(error))
  });

  const uploadGallery = useMutation({
    mutationFn: async () => {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.82
      });
      if (result.canceled || !result.assets[0]) return null;
      const asset = result.assets[0];
      return api.uploadHelperGallery(
        {
          uri: asset.uri,
          name: asset.fileName || "helper-gallery.jpg",
          mimeType: asset.mimeType || "image/jpeg"
        },
        galleryCaption
      );
    },
    onSuccess: (image) => {
      if (image) {
        setGalleryCaption("");
        refreshHelper();
      }
    },
    onError: (error) => Alert.alert("Gallery upload failed", errorMessage(error))
  });

  const startConnect = useMutation({
    mutationFn: api.createConnectAccount,
    onSuccess: async (response) => {
      refreshHelper();
      if (response.url) await Linking.openURL(response.url);
    },
    onError: (error) => Alert.alert("Payout setup failed", errorMessage(error))
  });

  return (
    <Screen>
      <View>
        <AppText variant="caption">HELPER WORK CENTER</AppText>
        <AppText variant="title">Find work, bid, schedule, and get paid.</AppText>
      </View>

      <View style={styles.sectionTabs}>
        {sections.map((item) => (
          <Pressable key={item.id} onPress={() => setSection(item.id)} style={[styles.tab, section === item.id && styles.tabActive]}>
            <AppText style={styles.tabLabel}>{item.label}</AppText>
          </Pressable>
        ))}
      </View>

      {section === "overview" && (
        <>
          <MetricGrid metrics={dashboardMetrics} />
          <Card>
            <AppText variant="headline">Today's queue</AppText>
            {(incomingBookings.data || []).slice(0, 3).map((booking) => (
              <View key={booking.id} style={styles.row}>
                <AppText>{bookingTitle(booking)}</AppText>
                <AppText variant="caption">
                  {[booking.customerName || booking.customer_name, bookingDate(booking), booking.status].filter(Boolean).join(" - ")}
                </AppText>
              </View>
            ))}
            {(!incomingBookings.data || incomingBookings.data.length === 0) && (
              <AppText variant="muted">No direct booking requests waiting right now.</AppText>
            )}
          </Card>
          <Card>
            <AppText variant="headline">Recent bid status</AppText>
            {(bids.data || []).slice(0, 4).map((bid) => (
              <View key={String(bid.id)} style={styles.row}>
                <AppText>{bid.job_title || "Job bid"}</AppText>
                <AppText variant="caption">{[money(bid.amount), bid.status, bid.location_city].filter(Boolean).join(" - ")}</AppText>
              </View>
            ))}
            {(!bids.data || bids.data.length === 0) && <AppText variant="muted">Submitted bids will show here.</AppText>}
          </Card>
        </>
      )}

      {section === "jobs" && (
        <>
          <Card>
            <AppText variant="headline">Find jobs</AppText>
            <FormInput placeholder="Search jobs" value={jobFilters.q} onChangeText={(q) => setJobFilters((prev) => ({ ...prev, q }))} />
            <View style={styles.gridTwo}>
              <FormInput placeholder="Category" value={jobFilters.category} onChangeText={(category) => setJobFilters((prev) => ({ ...prev, category }))} />
              <FormInput placeholder="City" value={jobFilters.city} onChangeText={(city) => setJobFilters((prev) => ({ ...prev, city }))} />
            </View>
            <View style={styles.gridTwo}>
              <FormInput placeholder="Miles" keyboardType="number-pad" value={jobFilters.radius} onChangeText={(radius) => setJobFilters((prev) => ({ ...prev, radius }))} />
              <Button variant="secondary" onPress={() => setJobFilters((prev) => ({ ...prev, sort: prev.sort === "urgent" ? "newest" : "urgent" }))}>
                {jobFilters.sort === "urgent" ? "Sort: Urgent" : "Sort: Newest"}
              </Button>
            </View>
          </Card>

          {(jobs.data?.jobs || []).map((job) => (
            <Card key={job.id}>
              <AppText variant="headline">{job.title}</AppText>
              <AppText variant="muted" numberOfLines={3}>{job.description || "No description provided."}</AppText>
              <AppText variant="caption">
                {[job.category_name, job.location_city, job.is_urgent ? "Urgent" : null, `${money(job.budget_min)}-${money(job.budget_max)}`].filter(Boolean).join(" - ")}
              </AppText>
              <Button variant="secondary" onPress={() => setSelectedJob(job)}>Bid on this job</Button>
            </Card>
          ))}

          {selectedJob && (
            <Card>
              <AppText variant="headline">Submit bid for {selectedJob.title}</AppText>
              <FormInput placeholder="Quote amount" keyboardType="decimal-pad" value={bidDraft.amount} onChangeText={(amount) => setBidDraft((prev) => ({ ...prev, amount }))} />
              <FormInput placeholder="Estimated hours" keyboardType="decimal-pad" value={bidDraft.etaHours} onChangeText={(etaHours) => setBidDraft((prev) => ({ ...prev, etaHours }))} />
              <FormInput placeholder="Availability note" multiline value={bidDraft.message} onChangeText={(message) => setBidDraft((prev) => ({ ...prev, message }))} />
              <Button onPress={() => submitBid.mutate()} disabled={submitBid.isPending}>Submit bid</Button>
            </Card>
          )}
        </>
      )}

      {section === "calendar" && (
        <>
          <Card>
            <AppText variant="headline">Booking requests</AppText>
            {(incomingBookings.data || []).map((booking) => (
              <View key={booking.id} style={styles.row}>
                <AppText>{bookingTitle(booking)}</AppText>
                <AppText variant="caption">{[booking.customerName || booking.customer_name, bookingDate(booking), bookingTime(booking)].filter(Boolean).join(" - ")}</AppText>
                <View style={styles.gridTwo}>
                  <Button onPress={() => acceptBooking.mutate(booking.id)} disabled={acceptBooking.isPending}>Accept</Button>
                  <Button variant="danger" onPress={() => declineBooking.mutate(booking.id)} disabled={declineBooking.isPending}>Decline</Button>
                </View>
              </View>
            ))}
            {(!incomingBookings.data || incomingBookings.data.length === 0) && <AppText variant="muted">No pending requests.</AppText>}
          </Card>

          <Card>
            <AppText variant="headline">Block time</AppText>
            <AppText variant="caption">Use ISO-style local date/time, for example 2026-05-21 14:00.</AppText>
            <FormInput placeholder="Start" value={availabilityDraft.start} onChangeText={(start) => setAvailabilityDraft((prev) => ({ ...prev, start }))} />
            <FormInput placeholder="End" value={availabilityDraft.end} onChangeText={(end) => setAvailabilityDraft((prev) => ({ ...prev, end }))} />
            <FormInput placeholder="Reason" value={availabilityDraft.notes} onChangeText={(notes) => setAvailabilityDraft((prev) => ({ ...prev, notes }))} />
            <Button onPress={() => blockTime.mutate()} disabled={blockTime.isPending}>Block unavailable time</Button>
          </Card>

          <Card>
            <AppText variant="headline">Agenda</AppText>
            {(appointments.data || []).slice(0, 8).map((appointment) => (
              <View key={appointment.id} style={styles.row}>
                <AppText>{appointment.title || "Appointment"}</AppText>
                <AppText variant="caption">{[appointment.scheduled_start_time, appointment.status].filter(Boolean).join(" - ")}</AppText>
              </View>
            ))}
            {(!appointments.data || appointments.data.length === 0) && <AppText variant="muted">Accepted bookings and appointments will appear here.</AppText>}
          </Card>

          <Card>
            <AppText variant="headline">Availability blocks</AppText>
            {(availability.data || []).slice(0, 8).map((block) => (
              <View key={String(block.id)} style={styles.row}>
                <AppText>{block.title || block.type}</AppText>
                <AppText variant="caption">{[block.start_time, block.end_time].filter(Boolean).join(" - ")}</AppText>
              </View>
            ))}
          </Card>
        </>
      )}

      {section === "profile" && (
        <>
          <Card>
            <AppText variant="headline">Public profile</AppText>
            <FormInput placeholder="Headline" value={profileDraft.profile_headline} onChangeText={(profile_headline) => setProfileDraft((prev) => ({ ...prev, profile_headline }))} />
            <FormInput placeholder="Short bio" multiline value={profileDraft.bio_short} onChangeText={(bio_short) => setProfileDraft((prev) => ({ ...prev, bio_short }))} />
            <View style={styles.gridTwo}>
              <FormInput placeholder="City" value={profileDraft.service_city} onChangeText={(service_city) => setProfileDraft((prev) => ({ ...prev, service_city }))} />
              <FormInput placeholder="State" value={profileDraft.service_state} onChangeText={(service_state) => setProfileDraft((prev) => ({ ...prev, service_state }))} />
            </View>
            <FormInput placeholder="Service radius miles" keyboardType="number-pad" value={profileDraft.service_radius_miles} onChangeText={(service_radius_miles) => setProfileDraft((prev) => ({ ...prev, service_radius_miles }))} />
            <Button onPress={() => saveProfile.mutate()} disabled={saveProfile.isPending}>Save profile</Button>
          </Card>

          <Card>
            <AppText variant="headline">Services</AppText>
            {(profile.data?.services || []).slice(0, 4).map((service) => (
              <AppText key={String(service.id)} variant="caption">{service.name} - {service.price_unit === "quote" ? "Quote" : money(service.price)}</AppText>
            ))}
            <FormInput placeholder="Service name" value={serviceDraft.name} onChangeText={(name) => setServiceDraft((prev) => ({ ...prev, name }))} />
            <FormInput placeholder="Starting price" keyboardType="decimal-pad" value={serviceDraft.price} onChangeText={(price) => setServiceDraft((prev) => ({ ...prev, price }))} />
            <FormInput placeholder="Duration" value={serviceDraft.duration} onChangeText={(duration) => setServiceDraft((prev) => ({ ...prev, duration }))} />
            <FormInput placeholder="Description" multiline value={serviceDraft.description} onChangeText={(description) => setServiceDraft((prev) => ({ ...prev, description }))} />
            <Button onPress={() => addService.mutate()} disabled={addService.isPending || !serviceDraft.name}>Add service</Button>
          </Card>

          <Card>
            <AppText variant="headline">Policies and gallery</AppText>
            <FormInput placeholder="Policy title" value={policyDraft.title} onChangeText={(title) => setPolicyDraft((prev) => ({ ...prev, title }))} />
            <FormInput placeholder="Policy details" multiline value={policyDraft.content} onChangeText={(content) => setPolicyDraft((prev) => ({ ...prev, content }))} />
            <Button variant="secondary" onPress={() => addPolicy.mutate()} disabled={addPolicy.isPending || !policyDraft.title || !policyDraft.content}>Add policy</Button>
            <FormInput placeholder="Gallery caption" value={galleryCaption} onChangeText={setGalleryCaption} />
            <Button variant="secondary" onPress={() => uploadGallery.mutate()} disabled={uploadGallery.isPending}>Upload gallery photo</Button>
            {qrCode.data?.qr_code ? (
              <Image source={{ uri: qrCode.data.qr_code }} style={styles.qrCode} />
            ) : null}
            <AppText variant="caption">QR: {qrCode.data?.profile_url || `https://oxsteed.com/helpers/${String(feed.data?.user.id || "")}`}</AppText>
          </Card>
        </>
      )}

      {section === "earnings" && (
        <>
          <MetricGrid
            metrics={[
              { label: "Payout ready", value: connect.data?.payouts_enabled ? "Yes" : "No" },
              { label: "Charges", value: connect.data?.charges_enabled ? "On" : "Off" },
              { label: "Payments", value: payments.data?.total ?? 0 },
              {
                label: "Captured",
                value: money((payments.data?.payments || []).filter((payment) => payment.status === "captured").reduce((sum, payment) => sum + Number(payment.amount || 0), 0))
              }
            ]}
          />
          <Card>
            <AppText variant="headline">Stripe Connect payouts</AppText>
            <AppText variant="muted">
              {connect.data?.connected
                ? "Your connected account is on file. Complete onboarding if payouts or charges are still off."
                : "Connect a payout account so paid jobs can move through Stripe Connect."}
            </AppText>
            <Button onPress={() => startConnect.mutate()} disabled={startConnect.isPending}>
              {connect.data?.connected ? "Continue payout setup" : "Set up payouts"}
            </Button>
          </Card>
          <Card>
            <AppText variant="headline">Payment history</AppText>
            {(payments.data?.payments || []).map((payment) => (
              <View key={String(payment.id)} style={styles.row}>
                <AppText>{payment.job_title || "Job payment"}</AppText>
                <AppText variant="caption">{[money(payment.amount), payment.status, payment.payment_hold_status].filter(Boolean).join(" - ")}</AppText>
              </View>
            ))}
            {(!payments.data || payments.data.payments.length === 0) && <AppText variant="muted">Completed job payments will show here.</AppText>}
          </Card>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionTabs: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  tab: {
    minHeight: 38,
    paddingHorizontal: spacing.md,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.panelSoft
  },
  tabActive: {
    borderColor: colors.orange,
    backgroundColor: colors.orangeDark
  },
  tabLabel: {
    fontWeight: "700"
  },
  row: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border
  },
  gridTwo: {
    flexDirection: "row",
    gap: spacing.sm
  },
  gridInput: {
    flex: 1
  },
  qrCode: {
    width: 156,
    height: 156,
    alignSelf: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.text
  }
});
