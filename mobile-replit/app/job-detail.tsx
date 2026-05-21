import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useHelpers, useJob, useSubmitBid } from "@/hooks/useApi";
import { useColors } from "@/hooks/useColors";

export default function JobDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data: job, isLoading: jobLoading } = useJob(id ?? "");
  const { data: helpers = [] } = useHelpers();
  const submitBidMutation = useSubmitBid();

  const [bidAmount, setBidAmount] = useState("");
  const [bidNote, setBidNote] = useState("");

  const suggestedHelpers = (helpers as any[]).slice(0, 3);
  const bidSubmitted = submitBidMutation.isSuccess;

  const handleBid = () => {
    if (!bidAmount.trim() || !id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    submitBidMutation.mutate({
      jobId: id,
      amount: parseFloat(bidAmount),
      note: bidNote.trim() || undefined,
    });
  };

  if (jobLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!job) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <Feather name="alert-circle" size={32} color={colors.mutedForeground} />
        <Text style={[styles.errorText, { color: colors.mutedForeground }]}>Job not found</Text>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7}>
          <Text style={[styles.backLink, { color: colors.primary }]}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const budget = (job as any).budget ?? (job as any).budgetRange ?? "—";
  const location = (job as any).location ?? (job as any).address ?? "—";
  const bids = (job as any).bidCount ?? (job as any).bids ?? 0;
  const postedAt = (job as any).postedAt ?? (job as any).createdAt;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <TouchableOpacity
          style={[styles.backBtn, { paddingTop: insets.top + 12 }]}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Feather name="arrow-left" size={20} color={colors.foreground} />
          <Text style={[styles.backText, { color: colors.foreground }]}>Back</Text>
        </TouchableOpacity>

        {/* Header card */}
        <View style={[styles.headerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.headerTop}>
            {!!(job as any).category && (
              <View style={[styles.categoryBadge, { backgroundColor: colors.primary + "20" }]}>
                <Text style={[styles.categoryText, { color: colors.primary }]}>{(job as any).category}</Text>
              </View>
            )}
            {(job as any).urgent && (
              <View style={[styles.urgentBadge, { backgroundColor: "#EF444420" }]}>
                <Feather name="alert-circle" size={12} color="#EF4444" />
                <Text style={styles.urgentText}>Urgent</Text>
              </View>
            )}
          </View>

          <Text style={[styles.jobTitle, { color: colors.foreground }]}>{(job as any).title}</Text>
          <Text style={[styles.description, { color: colors.mutedForeground }]}>{(job as any).description}</Text>

          <View style={styles.metaGrid}>
            {budget !== "—" && (
              <View style={[styles.metaItem, { backgroundColor: colors.background }]}>
                <Feather name="dollar-sign" size={16} color={colors.primary} />
                <Text style={[styles.metaValue, { color: colors.foreground }]}>{budget}</Text>
                <Text style={[styles.metaLabel, { color: colors.mutedForeground }]}>budget</Text>
              </View>
            )}
            <View style={[styles.metaItem, { backgroundColor: colors.background }]}>
              <Feather name="map-pin" size={16} color={colors.primary} />
              <Text style={[styles.metaValue, { color: colors.foreground }]} numberOfLines={1}>{location}</Text>
              <Text style={[styles.metaLabel, { color: colors.mutedForeground }]}>location</Text>
            </View>
            <View style={[styles.metaItem, { backgroundColor: colors.background }]}>
              <Feather name="users" size={16} color={colors.primary} />
              <Text style={[styles.metaValue, { color: colors.foreground }]}>{bids}</Text>
              <Text style={[styles.metaLabel, { color: colors.mutedForeground }]}>bids</Text>
            </View>
            {!!postedAt && (
              <View style={[styles.metaItem, { backgroundColor: colors.background }]}>
                <Feather name="clock" size={16} color={colors.primary} />
                <Text style={[styles.metaValue, { color: colors.foreground }]}>
                  {typeof postedAt === "string" && postedAt.includes("T")
                    ? new Date(postedAt).toLocaleDateString()
                    : postedAt}
                </Text>
                <Text style={[styles.metaLabel, { color: colors.mutedForeground }]}>posted</Text>
              </View>
            )}
          </View>
        </View>

        {/* Bid form */}
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          {bidSubmitted ? "Bid submitted!" : "Submit your bid"}
        </Text>

        {submitBidMutation.isError && (
          <View style={[styles.errorBox, { backgroundColor: "#EF444420", borderColor: "#EF4444" }]}>
            <Feather name="alert-circle" size={14} color="#EF4444" />
            <Text style={styles.errorMsg}>
              {(submitBidMutation.error as any)?.response?.data?.message ?? "Failed to submit bid. Please try again."}
            </Text>
          </View>
        )}

        {bidSubmitted ? (
          <View style={[styles.successCard, { backgroundColor: colors.card, borderColor: colors.primary }]}>
            <Feather name="check-circle" size={24} color={colors.primary} />
            <Text style={[styles.successText, { color: colors.foreground }]}>
              Your bid of ${bidAmount} has been sent. The customer will review and respond soon.
            </Text>
          </View>
        ) : (
          <View style={[styles.bidForm, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.bidLabel, { color: colors.foreground }]}>Your price ($)</Text>
            <TextInput
              style={[styles.bidInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
              value={bidAmount}
              onChangeText={setBidAmount}
              placeholder="e.g. 85"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="numeric"
              returnKeyType="next"
            />
            <Text style={[styles.bidLabel, { color: colors.foreground }]}>Message (optional)</Text>
            <TextInput
              style={[styles.bidTextarea, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
              value={bidNote}
              onChangeText={setBidNote}
              placeholder="Introduce yourself, describe your experience..."
              placeholderTextColor={colors.mutedForeground}
              multiline numberOfLines={3} textAlignVertical="top"
            />
            <TouchableOpacity
              style={[styles.bidBtn, { backgroundColor: bidAmount.trim() && !submitBidMutation.isPending ? colors.primary : colors.muted }]}
              onPress={handleBid}
              disabled={!bidAmount.trim() || submitBidMutation.isPending}
              activeOpacity={0.85}
            >
              {submitBidMutation.isPending ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={[styles.bidBtnText, { color: bidAmount.trim() ? "#FFFFFF" : colors.mutedForeground }]}>
                  Submit Bid
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Suggested helpers */}
        {suggestedHelpers.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Suggested helpers</Text>
            {suggestedHelpers.map((helper: any) => {
              const name = helper.name ?? helper.displayName ?? "Helper";
              const rating = helper.rating ?? helper.averageRating ?? 0;
              const reviewCount = helper.reviewCount ?? 0;
              const rate = helper.hourlyRate ?? helper.rate ?? 0;
              const AVATAR_COLORS = ["#3B82F6", "#10B981", "#F97316", "#8B5CF6"];
              let hash = 0;
              for (let i = 0; i < (helper.id ?? "0").length; i++) hash = (helper.id ?? "0").charCodeAt(i) + ((hash << 5) - hash);
              const color = helper.color ?? AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
              const initials = name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();

              return (
                <TouchableOpacity
                  key={helper.id}
                  style={[styles.helperRow, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    router.push({ pathname: "/helper-profile", params: { id: helper.id } });
                  }}
                  activeOpacity={0.75}
                >
                  <View style={[styles.helperAvatar, { backgroundColor: color }]}>
                    <Text style={styles.helperAvatarText}>{initials}</Text>
                  </View>
                  <View style={styles.helperInfo}>
                    <Text style={[styles.helperName, { color: colors.foreground }]}>{name}</Text>
                    {rating > 0 && (
                      <View style={styles.ratingRow}>
                        <Feather name="star" size={12} color="#F59E0B" />
                        <Text style={[styles.helperRating, { color: colors.mutedForeground }]}>
                          {Number(rating).toFixed(2)} · {reviewCount} reviews
                        </Text>
                      </View>
                    )}
                  </View>
                  {rate > 0 && <Text style={[styles.helperRate, { color: colors.primary }]}>${rate}/hr</Text>}
                </TouchableOpacity>
              );
            })}
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  errorText: { fontSize: 16, fontFamily: "Inter_400Regular" },
  backLink: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  scroll: { paddingHorizontal: 16, paddingBottom: 40 },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 16 },
  backText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  headerCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 24 },
  headerTop: { flexDirection: "row", gap: 8, marginBottom: 12 },
  categoryBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  categoryText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  urgentBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  urgentText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#EF4444" },
  jobTitle: { fontSize: 22, fontFamily: "Inter_700Bold", marginBottom: 8 },
  description: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21, marginBottom: 16 },
  metaGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metaItem: { flex: 1, minWidth: "45%", borderRadius: 10, padding: 10, gap: 2 },
  metaValue: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  metaLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  sectionTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 12 },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 12 },
  errorMsg: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#EF4444", flex: 1 },
  bidForm: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 24 },
  bidLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 8 },
  bidInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, fontFamily: "Inter_400Regular", marginBottom: 14 },
  bidTextarea: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 14, minHeight: 80 },
  bidBtn: { borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  bidBtnText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  successCard: { flexDirection: "row", gap: 12, borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 24, alignItems: "flex-start" },
  successText: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  helperRow: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 10 },
  helperAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  helperAvatarText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  helperInfo: { flex: 1, gap: 2 },
  helperName: { fontSize: 14, fontFamily: "Inter_700Bold" },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  helperRating: { fontSize: 12, fontFamily: "Inter_400Regular" },
  helperRate: { fontSize: 14, fontFamily: "Inter_700Bold" },
});
