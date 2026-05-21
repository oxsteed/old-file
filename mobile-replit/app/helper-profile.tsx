import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useApp } from "@/context/AppContext";
import { useCreateBooking, useHelperProfile } from "@/hooks/useApi";
import { useColors } from "@/hooks/useColors";

const AVATAR_COLORS = ["#3B82F6", "#10B981", "#F97316", "#8B5CF6", "#EC4899", "#06B6D4"];

function getColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export default function HelperProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { savedHelpers, toggleSavedHelper } = useApp();
  const createBookingMutation = useCreateBooking();

  const { data: helper, isLoading } = useHelperProfile(id ?? "");
  const isSaved = savedHelpers.includes(id ?? "");

  const name = (helper as any)?.name ?? (helper as any)?.displayName ?? (helper as any)?.user?.name ?? "Helper";
  const initials = name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();
  const color = getColor(id ?? "0");
  const rating = (helper as any)?.rating ?? (helper as any)?.averageRating ?? 0;
  const reviewCount = (helper as any)?.reviewCount ?? (helper as any)?.totalReviews ?? 0;
  const hourlyRate = (helper as any)?.hourlyRate ?? (helper as any)?.rate ?? 0;
  const distance = (helper as any)?.distance ?? "";
  const responseTime = (helper as any)?.responseTime ?? "";
  const verified = (helper as any)?.verified ?? (helper as any)?.isVerified ?? false;
  const bio = (helper as any)?.bio ?? (helper as any)?.description ?? "";
  const skills = (helper as any)?.skills ?? (helper as any)?.serviceCategories ?? [];
  const completedJobs = (helper as any)?.completedJobs ?? (helper as any)?.jobsCompleted ?? 0;
  const reviews: any[] = (helper as any)?.reviews ?? [];

  const booked = createBookingMutation.isSuccess;

  const handleBook = () => {
    if (!id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    createBookingMutation.mutate({ helperId: id });
  };

  if (isLoading) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!helper) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: colors.background }]}>
        <Feather name="alert-circle" size={32} color={colors.mutedForeground} />
        <Text style={[styles.errorText, { color: colors.mutedForeground }]}>Helper not found</Text>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7}>
          <Text style={[styles.backLink, { color: colors.primary }]}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Top bar */}
        <View style={[styles.topBar, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color={colors.foreground} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              toggleSavedHelper(id ?? "");
            }}
            activeOpacity={0.7}
            style={[styles.saveBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Feather name="bookmark" size={18} color={isSaved ? colors.primary : colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        {/* Hero */}
        <View style={styles.heroSection}>
          <View style={[styles.avatar, { backgroundColor: color }]}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={styles.nameRow}>
            <Text style={[styles.helperName, { color: colors.foreground }]}>{name}</Text>
            {verified && (
              <View style={[styles.verifiedBadge, { backgroundColor: colors.primary + "20" }]}>
                <Feather name="check-circle" size={12} color={colors.primary} />
                <Text style={[styles.verifiedText, { color: colors.primary }]}>Verified</Text>
              </View>
            )}
          </View>
          {rating > 0 && (
            <View style={styles.ratingRow}>
              {[1, 2, 3, 4, 5].map((s) => (
                <Feather key={s} name="star" size={18} color={s <= Math.round(rating) ? "#F59E0B" : colors.muted} />
              ))}
              <Text style={[styles.ratingNum, { color: colors.foreground }]}>{Number(rating).toFixed(2)}</Text>
              <Text style={[styles.reviewCountText, { color: colors.mutedForeground }]}>({reviewCount})</Text>
            </View>
          )}
          {!!bio && <Text style={[styles.bio, { color: colors.mutedForeground }]}>{bio}</Text>}
        </View>

        {/* Stats */}
        <View style={[styles.statsRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {completedJobs > 0 && (
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: colors.foreground }]}>{completedJobs}</Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>jobs done</Text>
            </View>
          )}
          {hourlyRate > 0 && (
            <>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.stat}>
                <Text style={[styles.statValue, { color: colors.primary }]}>${hourlyRate}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>per hour</Text>
              </View>
            </>
          )}
          {!!responseTime && (
            <>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.stat}>
                <Text style={[styles.statValue, { color: colors.foreground }]}>{responseTime}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>response</Text>
              </View>
            </>
          )}
          {!!distance && (
            <>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.stat}>
                <Text style={[styles.statValue, { color: colors.foreground }]}>{distance}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>away</Text>
              </View>
            </>
          )}
        </View>

        {/* Skills */}
        {skills.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Skills</Text>
            <View style={styles.skillsGrid}>
              {skills.map((skill: string) => (
                <View key={skill} style={[styles.skillPill, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Feather name="check" size={12} color={colors.primary} />
                  <Text style={[styles.skillText, { color: colors.foreground }]}>{skill}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Reviews */}
        {reviews.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Reviews</Text>
            {reviews.slice(0, 5).map((review: any, i: number) => (
              <View key={review.id ?? i} style={[styles.reviewCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.reviewHeader}>
                  <Text style={[styles.reviewAuthor, { color: colors.foreground }]}>
                    {review.reviewerName ?? review.author ?? review.customer?.name ?? "Customer"}
                  </Text>
                  <View style={styles.reviewRating}>
                    {Array.from({ length: review.rating ?? 5 }).map((_, j) => (
                      <Feather key={j} name="star" size={12} color="#F59E0B" />
                    ))}
                  </View>
                  {!!review.createdAt && (
                    <Text style={[styles.reviewDate, { color: colors.mutedForeground }]}>
                      {new Date(review.createdAt).toLocaleDateString()}
                    </Text>
                  )}
                </View>
                {!!(review.comment ?? review.text ?? review.body) && (
                  <Text style={[styles.reviewText, { color: colors.mutedForeground }]}>
                    {review.comment ?? review.text ?? review.body}
                  </Text>
                )}
              </View>
            ))}
          </>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Book CTA */}
      <View style={[styles.bookBar, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.priceInfo}>
          {hourlyRate > 0 ? (
            <>
              <Text style={[styles.price, { color: colors.primary }]}>${hourlyRate}/hr</Text>
              <Text style={[styles.priceNote, { color: colors.mutedForeground }]}>starting rate</Text>
            </>
          ) : (
            <Text style={[styles.price, { color: colors.foreground }]}>Get a quote</Text>
          )}
        </View>
        <TouchableOpacity
          style={[styles.bookBtn, { backgroundColor: booked ? colors.muted : colors.primary }]}
          onPress={handleBook}
          disabled={booked || createBookingMutation.isPending}
          activeOpacity={0.85}
        >
          {createBookingMutation.isPending ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : booked ? (
            <>
              <Feather name="check" size={18} color={colors.mutedForeground} />
              <Text style={[styles.bookBtnText, { color: colors.mutedForeground }]}>Booking sent</Text>
            </>
          ) : (
            <>
              <Feather name="calendar" size={18} color="#FFFFFF" />
              <Text style={styles.bookBtnText}>Book {name.split(" ")[0]}</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center", gap: 12 },
  errorText: { fontSize: 16, fontFamily: "Inter_400Regular" },
  backLink: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  scroll: { paddingHorizontal: 16, paddingBottom: 40 },
  topBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  backBtn: { padding: 4 },
  saveBtn: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  heroSection: { alignItems: "center", marginBottom: 20, gap: 10 },
  avatar: { width: 88, height: 88, borderRadius: 44, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 32, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  helperName: { fontSize: 24, fontFamily: "Inter_700Bold" },
  verifiedBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  verifiedText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  ratingNum: { fontSize: 16, fontFamily: "Inter_700Bold", marginLeft: 4 },
  reviewCountText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  bio: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21, textAlign: "center", paddingHorizontal: 8 },
  statsRow: { flexDirection: "row", borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 24 },
  stat: { flex: 1, alignItems: "center" },
  statValue: { fontSize: 16, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2, textAlign: "center" },
  divider: { width: 1, marginVertical: 4 },
  sectionTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 12 },
  skillsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 24 },
  skillPill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  skillText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  reviewCard: { borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 10 },
  reviewHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  reviewAuthor: { fontSize: 14, fontFamily: "Inter_700Bold" },
  reviewRating: { flexDirection: "row", gap: 2, flex: 1 },
  reviewDate: { fontSize: 11, fontFamily: "Inter_400Regular" },
  reviewText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  bookBar: { position: "absolute", bottom: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, paddingHorizontal: 20, paddingTop: 12 },
  priceInfo: { gap: 1 },
  price: { fontSize: 22, fontFamily: "Inter_700Bold" },
  priceNote: { fontSize: 12, fontFamily: "Inter_400Regular" },
  bookBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 14 },
  bookBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
});
