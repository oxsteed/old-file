import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { useColors } from "@/hooks/useColors";

interface JobCardProps {
  job: any;
}

const CATEGORY_ICONS: Record<string, string> = {
  Tutoring: "book",
  Cleaning: "wind",
  Handyman: "tool",
  "Lawn Care": "scissors",
  "Pet Care": "heart",
  Moving: "truck",
  default: "briefcase",
};

export function JobCard({ job }: JobCardProps) {
  const colors = useColors();

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: "/job-detail", params: { id: job.id } });
  };

  const iconName = (CATEGORY_ICONS[job.category] ?? CATEGORY_ICONS.default) as any;
  const bids = job.bidCount ?? job.bids ?? 0;
  const budget = job.budget ?? job.budgetRange ?? "—";
  const location = job.location ?? job.address ?? "";
  const postedAt = job.postedAt ?? job.createdAt ?? "";

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={handlePress}
      activeOpacity={0.75}
    >
      <View style={styles.header}>
        <View style={[styles.categoryBadge, { backgroundColor: colors.primary + "20" }]}>
          <Feather name={iconName} size={12} color={colors.primary} />
          <Text style={[styles.categoryText, { color: colors.primary }]}>{job.category}</Text>
        </View>
        {job.urgent && (
          <View style={[styles.urgentBadge, { backgroundColor: "#EF444420" }]}>
            <Text style={styles.urgentText}>Urgent</Text>
          </View>
        )}
      </View>

      <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>{job.title}</Text>
      <Text style={[styles.description, { color: colors.mutedForeground }]} numberOfLines={2}>{job.description}</Text>

      <View style={styles.footer}>
        <View style={styles.footerLeft}>
          {!!budget && (
            <View style={styles.metaItem}>
              <Feather name="dollar-sign" size={12} color={colors.mutedForeground} />
              <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{budget}</Text>
            </View>
          )}
          {!!location && (
            <View style={styles.metaItem}>
              <Feather name="map-pin" size={12} color={colors.mutedForeground} />
              <Text style={[styles.metaText, { color: colors.mutedForeground }]} numberOfLines={1}>
                {String(location).split(",")[0]}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.bidsContainer}>
          <Text style={[styles.bidsCount, { color: colors.foreground }]}>{bids}</Text>
          <Text style={[styles.bidsLabel, { color: colors.mutedForeground }]}>{bids === 1 ? "bid" : "bids"}</Text>
        </View>
      </View>

      {!!postedAt && (
        <>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <Text style={[styles.timeAgo, { color: colors.mutedForeground }]}>
            {typeof postedAt === "string" && postedAt.includes("T")
              ? new Date(postedAt).toLocaleDateString()
              : postedAt}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  categoryBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  categoryText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  urgentBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  urgentText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#EF4444" },
  title: { fontSize: 16, fontFamily: "Inter_700Bold", marginBottom: 6 },
  description: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19, marginBottom: 12 },
  footer: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  footerLeft: { gap: 4 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  bidsContainer: { alignItems: "center" },
  bidsCount: { fontSize: 20, fontFamily: "Inter_700Bold" },
  bidsLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  divider: { height: 1, marginBottom: 10 },
  timeAgo: { fontSize: 11, fontFamily: "Inter_400Regular" },
});
