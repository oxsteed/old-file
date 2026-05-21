import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";

interface HelperCardProps {
  helper: any;
  compact?: boolean;
}

const AVATAR_COLORS = ["#3B82F6", "#10B981", "#F97316", "#8B5CF6", "#EC4899", "#06B6D4", "#F59E0B"];

function getColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name?: string): string {
  if (!name) return "?";
  return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

export function HelperCard({ helper, compact = false }: HelperCardProps) {
  const colors = useColors();
  const { savedHelpers, toggleSavedHelper } = useApp();
  const isSaved = savedHelpers.includes(helper.id);

  const name = helper.name ?? helper.displayName ?? helper.user?.name ?? "Helper";
  const initials = helper.initials ?? getInitials(name);
  const color = helper.color ?? getColor(helper.id ?? "0");
  const rating = helper.rating ?? helper.averageRating ?? 0;
  const reviewCount = helper.reviewCount ?? helper.totalReviews ?? 0;
  const hourlyRate = helper.hourlyRate ?? helper.rate ?? 0;
  const distance = helper.distance ?? "";
  const verified = helper.verified ?? helper.isVerified ?? false;
  const bio = helper.bio ?? helper.description ?? "";
  const skills = helper.skills ?? helper.serviceCategories ?? [];
  const completedJobs = helper.completedJobs ?? helper.jobsCompleted ?? 0;
  const responseTime = helper.responseTime ?? "";

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: "/helper-profile", params: { id: helper.id } });
  };

  const handleSave = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    toggleSavedHelper(helper.id);
  };

  if (compact) {
    return (
      <TouchableOpacity
        style={[styles.compactCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={handlePress}
        activeOpacity={0.75}
      >
        <View style={[styles.avatar, { backgroundColor: color }]}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <Text style={[styles.compactName, { color: colors.foreground }]} numberOfLines={1}>{name}</Text>
        {rating > 0 && (
          <View style={styles.compactRating}>
            <Feather name="star" size={11} color="#F59E0B" />
            <Text style={[styles.compactRatingText, { color: colors.mutedForeground }]}>{Number(rating).toFixed(1)}</Text>
          </View>
        )}
        {hourlyRate > 0 && (
          <Text style={[styles.compactRate, { color: colors.primary }]}>${hourlyRate}/hr</Text>
        )}
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={handlePress}
      activeOpacity={0.75}
    >
      <View style={styles.cardHeader}>
        <View style={[styles.avatar, styles.avatarLarge, { backgroundColor: color }]}>
          <Text style={[styles.avatarText, styles.avatarTextLarge]}>{initials}</Text>
        </View>
        <View style={styles.headerInfo}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: colors.foreground }]}>{name}</Text>
            {verified && <Feather name="check-circle" size={14} color={colors.primary} />}
          </View>
          {rating > 0 && (
            <View style={styles.ratingRow}>
              <Feather name="star" size={13} color="#F59E0B" />
              <Text style={[styles.rating, { color: colors.foreground }]}>{Number(rating).toFixed(2)}</Text>
              <Text style={[styles.reviewCount, { color: colors.mutedForeground }]}>({reviewCount})</Text>
            </View>
          )}
          {(distance || responseTime) && (
            <Text style={[styles.distance, { color: colors.mutedForeground }]}>
              {distance ? `${distance} away` : ""}{distance && responseTime ? " · " : ""}
              {responseTime ? `Responds ${responseTime}` : ""}
            </Text>
          )}
        </View>
        <TouchableOpacity onPress={handleSave} activeOpacity={0.7} style={styles.saveBtn}>
          <Feather name="bookmark" size={20} color={isSaved ? colors.primary : colors.mutedForeground} />
        </TouchableOpacity>
      </View>

      {!!bio && (
        <Text style={[styles.bio, { color: colors.mutedForeground }]} numberOfLines={2}>{bio}</Text>
      )}

      {skills.length > 0 && (
        <View style={styles.skillsRow}>
          {skills.slice(0, 3).map((skill: string) => (
            <View key={skill} style={[styles.skillPill, { backgroundColor: colors.muted }]}>
              <Text style={[styles.skillText, { color: colors.secondaryForeground }]}>{skill}</Text>
            </View>
          ))}
          {skills.length > 3 && (
            <Text style={[styles.moreSkills, { color: colors.mutedForeground }]}>+{skills.length - 3}</Text>
          )}
        </View>
      )}

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        {completedJobs > 0 && (
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>{completedJobs}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>jobs done</Text>
          </View>
        )}
        {completedJobs > 0 && hourlyRate > 0 && <View style={[styles.dividerV, { backgroundColor: colors.border }]} />}
        {hourlyRate > 0 && (
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: colors.primary }]}>${hourlyRate}/hr</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>starting rate</Text>
          </View>
        )}
        <TouchableOpacity style={[styles.bookBtn, { backgroundColor: colors.primary }]} onPress={handlePress} activeOpacity={0.85}>
          <Text style={styles.bookBtnText}>Book</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12 },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 10 },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  avatarLarge: { width: 48, height: 48, borderRadius: 24 },
  avatarText: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  avatarTextLarge: { fontSize: 16 },
  headerInfo: { flex: 1, gap: 2 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  name: { fontSize: 16, fontFamily: "Inter_700Bold" },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  rating: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  reviewCount: { fontSize: 12, fontFamily: "Inter_400Regular" },
  distance: { fontSize: 12, fontFamily: "Inter_400Regular" },
  saveBtn: { padding: 4 },
  bio: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19, marginBottom: 12 },
  skillsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 },
  skillPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  skillText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  moreSkills: { fontSize: 12, fontFamily: "Inter_400Regular", alignSelf: "center" },
  footer: { flexDirection: "row", alignItems: "center", borderTopWidth: 1, paddingTop: 12, gap: 16 },
  stat: { alignItems: "center" },
  statValue: { fontSize: 14, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  dividerV: { width: 1, height: 28 },
  bookBtn: { marginLeft: "auto", paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20 },
  bookBtnText: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  compactCard: { width: 130, borderRadius: 16, borderWidth: 1, padding: 14, alignItems: "center", gap: 6, marginRight: 10 },
  compactName: { fontSize: 13, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  compactRating: { flexDirection: "row", alignItems: "center", gap: 3 },
  compactRatingText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  compactRate: { fontSize: 13, fontFamily: "Inter_700Bold" },
});
