import { useState } from "react";
import { ActivityIndicator, Image, StyleSheet, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, OxSteedApiError } from "../api/client";
import type { HelperDirectoryItem, HelperProfile } from "../api/types";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { FormInput } from "../components/FormInput";
import { Screen } from "../components/Screen";
import { AppText } from "../components/Text";
import { colors, spacing } from "../theme";

type BookingDraft = {
  serviceName: string;
  requestedDate: string;
  requestedStartTime: string;
  requestedEndTime: string;
  serviceLocation: string;
  description: string;
};

const initialBooking: BookingDraft = {
  serviceName: "",
  requestedDate: "",
  requestedStartTime: "09:00",
  requestedEndTime: "10:00",
  serviceLocation: "",
  description: ""
};

function money(value?: number, unit?: string) {
  if (!value) return "Contact for pricing";
  return `$${value}/${unit === "flat" ? "job" : "hr"}`;
}

export function BrowseHelpersScreen() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [activeHelper, setActiveHelper] = useState<HelperDirectoryItem | null>(null);
  const [booking, setBooking] = useState<BookingDraft>(initialBooking);
  const [status, setStatus] = useState<string | null>(null);

  const helpers = useQuery({
    queryKey: ["helpers", query],
    queryFn: () => api.listHelpers({ query, limit: 12, sort: "best_match" })
  });

  const profile = useQuery({
    queryKey: ["helper-profile", activeHelper?.id],
    enabled: Boolean(activeHelper),
    queryFn: () => api.helperProfile(activeHelper!.id)
  });

  async function openHelper(helper: HelperDirectoryItem) {
    setActiveHelper(helper);
    setBooking(initialBooking);
    setStatus(null);
  }

  async function messageHelper(profileData?: HelperProfile) {
    const helperId = profileData?.helper?.id || activeHelper?.id;
    if (!helperId) return;
    try {
      const conversation = await api.createConversation({ helperId });
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      setStatus(`Conversation opened with ${profileData?.helper?.businessName || activeHelper?.businessName || "helper"} (#${conversation.id}).`);
    } catch (error) {
      setStatus(error instanceof OxSteedApiError ? error.message : "Could not open conversation.");
    }
  }

  async function requestBooking(profileData?: HelperProfile) {
    const helperId = profileData?.helper?.id || activeHelper?.id;
    if (!helperId) return;
    try {
      await api.createBookingRequest({
        helperId,
        serviceName: booking.serviceName || profileData?.services?.[0]?.name || "Service request",
        requestedDate: booking.requestedDate,
        requestedStartTime: booking.requestedStartTime,
        requestedEndTime: booking.requestedEndTime,
        serviceLocation: booking.serviceLocation,
        description: booking.description
      });
      setStatus("Booking request sent. It will show in your dashboard once the helper responds.");
      setBooking(initialBooking);
      await queryClient.invalidateQueries({ queryKey: ["mobile-feed"] });
    } catch (error) {
      setStatus(error instanceof OxSteedApiError ? error.message : "Could not request booking.");
    }
  }

  if (activeHelper) {
    const data = profile.data;
    return (
      <Screen>
        <Button variant="secondary" onPress={() => setActiveHelper(null)}>Back to helpers</Button>
        {profile.isLoading ? (
          <ActivityIndicator color={colors.orange} />
        ) : (
          <>
            <Card>
              {data?.helper.coverImage ? <Image source={{ uri: data.helper.coverImage }} style={styles.cover} /> : null}
              <AppText variant="title">{data?.helper.businessName || activeHelper.businessName}</AppText>
              <AppText variant="muted">{data?.helper.tagline || activeHelper.shortBio || "OxSteed helper"}</AppText>
              <AppText variant="caption">
                {(data?.helper.rating || activeHelper.rating || 0).toFixed(1)} stars • {data?.helper.reviewCount || activeHelper.reviewCount || 0} reviews • {data?.helper.responseTime || activeHelper.responseTime || "Response varies"}
              </AppText>
              <View style={styles.actions}>
                <Button onPress={() => messageHelper(data)}>Message</Button>
                <Button variant="secondary" onPress={() => setBooking((draft) => ({ ...draft, serviceName: data?.services?.[0]?.name || "" }))}>
                  Start booking
                </Button>
              </View>
            </Card>

            <Card>
              <AppText variant="headline">Services</AppText>
              {(data?.services || []).slice(0, 6).map((service) => (
                <View key={service.id} style={styles.row}>
                  <AppText>{service.name}</AppText>
                  <AppText variant="caption">{money(service.price, service.priceUnit)} {service.duration ? `• ${service.duration}` : ""}</AppText>
                </View>
              ))}
              {(data?.services || []).length === 0 && <AppText variant="muted">No listed services yet.</AppText>}
            </Card>

            <Card>
              <AppText variant="headline">Direct booking request</AppText>
              <FormInput placeholder="Service name" value={booking.serviceName} onChangeText={(serviceName) => setBooking((draft) => ({ ...draft, serviceName }))} />
              <FormInput placeholder="Date YYYY-MM-DD" value={booking.requestedDate} onChangeText={(requestedDate) => setBooking((draft) => ({ ...draft, requestedDate }))} />
              <View style={styles.split}>
                <FormInput style={styles.splitInput} placeholder="Start HH:MM" value={booking.requestedStartTime} onChangeText={(requestedStartTime) => setBooking((draft) => ({ ...draft, requestedStartTime }))} />
                <FormInput style={styles.splitInput} placeholder="End HH:MM" value={booking.requestedEndTime} onChangeText={(requestedEndTime) => setBooking((draft) => ({ ...draft, requestedEndTime }))} />
              </View>
              <FormInput placeholder="Location" value={booking.serviceLocation} onChangeText={(serviceLocation) => setBooking((draft) => ({ ...draft, serviceLocation }))} />
              <FormInput multiline placeholder="Notes for the helper" value={booking.description} onChangeText={(description) => setBooking((draft) => ({ ...draft, description }))} />
              {status && <AppText variant="muted">{status}</AppText>}
              <Button disabled={!booking.requestedDate || !booking.requestedStartTime || !booking.requestedEndTime} onPress={() => requestBooking(data)}>
                Request booking
              </Button>
            </Card>

            <Card>
              <AppText variant="headline">Trust and policies</AppText>
              {(data?.helper.badges || []).map((badge) => <AppText key={badge.id}>• {badge.label}</AppText>)}
              {(data?.policies || []).slice(0, 3).map((policy) => (
                <View key={policy.id} style={styles.row}>
                  <AppText>{policy.title}</AppText>
                  <AppText variant="muted">{policy.content}</AppText>
                </View>
              ))}
            </Card>
          </>
        )}
      </Screen>
    );
  }

  return (
    <Screen>
      <View>
        <AppText variant="caption">HELPER DISCOVERY</AppText>
        <AppText variant="title">Compare helpers before you book.</AppText>
      </View>
      <Card>
        <FormInput placeholder="Search service, skill, or name" value={query} onChangeText={setQuery} />
        <Button variant="secondary" onPress={() => helpers.refetch()}>Search</Button>
      </Card>
      {helpers.isLoading ? <ActivityIndicator color={colors.orange} /> : null}
      {(helpers.data?.helpers || []).map((helper) => (
        <Card key={String(helper.id)}>
          <View style={styles.helperHeader}>
            {helper.avatar ? <Image source={{ uri: helper.avatar }} style={styles.avatar} /> : <View style={styles.avatarFallback} />}
            <View style={styles.helperCopy}>
              <AppText variant="headline">{helper.businessName || helper.ownerName || "OxSteed helper"}</AppText>
              <AppText variant="caption">{[helper.city, helper.state].filter(Boolean).join(", ") || "Local service area"}</AppText>
            </View>
          </View>
          <AppText variant="muted">{helper.shortBio || (helper.skills || []).slice(0, 4).join(", ")}</AppText>
          <AppText variant="caption">
            {(helper.rating || 0).toFixed(1)} stars • {helper.reviewCount || 0} reviews • {money(helper.startingPrice, helper.startingPriceUnit)}
          </AppText>
          <Button onPress={() => openHelper(helper)}>View profile</Button>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  helperHeader: {
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "center"
  },
  helperCopy: {
    flex: 1
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28
  },
  avatarFallback: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.panelSoft
  },
  cover: {
    width: "100%",
    height: 140,
    borderRadius: 8
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm
  },
  row: {
    gap: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border
  },
  split: {
    flexDirection: "row",
    gap: spacing.sm
  },
  splitInput: {
    flex: 1
  }
});
