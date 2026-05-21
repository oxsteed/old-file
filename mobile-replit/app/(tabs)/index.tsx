import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HelperCard } from "@/components/HelperCard";
import { JobCard } from "@/components/JobCard";
import { SearchBar } from "@/components/SearchBar";
import { useAuth } from "@/context/AuthContext";
import { useFeed, useHelpers, useJobs } from "@/hooks/useApi";
import { useColors } from "@/hooks/useColors";

const CATEGORIES = [
  { id: "tutoring", name: "Tutoring", icon: "book" },
  { id: "cleaning", name: "Cleaning", icon: "wind" },
  { id: "handyman", name: "Handyman", icon: "tool" },
  { id: "lawn", name: "Lawn Care", icon: "scissors" },
  { id: "pets", name: "Pet Care", icon: "heart" },
  { id: "moving", name: "Moving", icon: "truck" },
  { id: "tools", name: "Tool Rental", icon: "box" },
  { id: "events", name: "Events", icon: "calendar" },
] as const;

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [search, setSearch] = useState("");

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const { data: feedData, isLoading: feedLoading, refetch: refetchFeed, isRefetching } = useFeed();
  const { data: jobsData = [], isLoading: jobsLoading, refetch: refetchJobs } = useJobs();
  const { data: helpersData = [], isLoading: helpersLoading, refetch: refetchHelpers } = useHelpers();

  const jobs = (feedData?.jobs as any[] | undefined) ?? jobsData;
  const helpers = (feedData?.helpers as any[] | undefined) ?? helpersData;

  const urgentJobs = jobs.filter((j: any) => j.urgent).slice(0, 3);
  const recentJobs = jobs.filter((j: any) => !j.urgent).slice(0, 4);
  const allJobs = jobs.slice(0, 4);

  const role = user?.role ?? "customer";

  const roleLabel = {
    customer: "Welcome back",
    helper: "Your Dashboard",
    business: "Business Hub",
    tool_owner: "Tool Listings",
  }[role] ?? "Welcome back";

  const isLoading = feedLoading && jobsLoading;

  const onRefresh = () => {
    refetchFeed();
    refetchJobs();
    refetchHelpers();
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: topPad + 16, paddingBottom: Platform.OS === "web" ? 120 : 100 },
        ]}
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <View>
            <Text style={[styles.greeting, { color: colors.mutedForeground }]}>{roleLabel}</Text>
            <Text style={[styles.headTitle, { color: colors.foreground }]}>
              {user?.name?.split(" ")[0] ?? "OxSteed"}
            </Text>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={[styles.iconBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push("/(tabs)/messages");
              }}
              activeOpacity={0.75}
            >
              <Feather name="bell" size={20} color={colors.foreground} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.avatarBtn, { backgroundColor: colors.primary }]}
              onPress={() => router.push("/(tabs)/profile")}
              activeOpacity={0.75}
            >
              <Text style={styles.avatarText}>
                {(user?.name ?? "U")[0].toUpperCase()}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Search */}
        <View style={styles.searchWrapper}>
          <SearchBar
            value={search}
            onChangeText={setSearch}
            placeholder="Search jobs, helpers, or tools..."
            onClear={() => setSearch("")}
          />
        </View>

        {/* Quick CTA */}
        {role === "customer" && (
          <TouchableOpacity
            style={[styles.postBanner, { backgroundColor: colors.primary }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              router.push("/(tabs)/post");
            }}
            activeOpacity={0.85}
          >
            <View>
              <Text style={styles.postBannerTitle}>Need something done?</Text>
              <Text style={styles.postBannerSub}>Post a job — get bids in minutes</Text>
            </View>
            <Feather name="arrow-right" size={22} color="#FFFFFF" />
          </TouchableOpacity>
        )}

        {role === "helper" && (
          <TouchableOpacity
            style={[styles.postBanner, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}
            onPress={() => router.push("/(tabs)/browse")}
            activeOpacity={0.85}
          >
            <View>
              <Text style={[styles.postBannerTitle, { color: colors.foreground }]}>Browse open jobs</Text>
              <Text style={[styles.postBannerSub, { color: colors.mutedForeground }]}>Find work near you and submit bids</Text>
            </View>
            <Feather name="arrow-right" size={22} color={colors.primary} />
          </TouchableOpacity>
        )}

        {/* Categories */}
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Browse by category</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoriesRow}
        >
          {CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat.id}
              style={[styles.categoryCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push("/(tabs)/browse");
              }}
              activeOpacity={0.75}
            >
              <View style={[styles.categoryIcon, { backgroundColor: colors.primary + "20" }]}>
                <Feather name={cat.icon as any} size={20} color={colors.primary} />
              </View>
              <Text style={[styles.categoryName, { color: colors.foreground }]}>{cat.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Loading */}
        {isLoading && (
          <View style={styles.loadingCenter}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Loading feed…</Text>
          </View>
        )}

        {/* Urgent Jobs */}
        {!isLoading && urgentJobs.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Urgent jobs</Text>
              <TouchableOpacity onPress={() => router.push("/(tabs)/browse")} activeOpacity={0.7}>
                <Text style={[styles.seeAll, { color: colors.primary }]}>See all</Text>
              </TouchableOpacity>
            </View>
            {urgentJobs.map((job: any) => <JobCard key={job.id} job={job} />)}
          </>
        )}

        {/* Top Helpers */}
        {!isLoading && helpers.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Top helpers nearby</Text>
              <TouchableOpacity onPress={() => router.push("/(tabs)/browse")} activeOpacity={0.7}>
                <Text style={[styles.seeAll, { color: colors.primary }]}>See all</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.helpersRow}
            >
              {helpers.slice(0, 8).map((helper: any) => (
                <HelperCard key={helper.id} helper={helper} compact />
              ))}
            </ScrollView>
          </>
        )}

        {/* Recent Jobs */}
        {!isLoading && allJobs.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Recent postings</Text>
              <TouchableOpacity onPress={() => router.push("/(tabs)/browse")} activeOpacity={0.7}>
                <Text style={[styles.seeAll, { color: colors.primary }]}>See all</Text>
              </TouchableOpacity>
            </View>
            {allJobs.map((job: any) => <JobCard key={job.id} job={job} />)}
          </>
        )}

        {/* Empty state */}
        {!isLoading && jobs.length === 0 && helpers.length === 0 && (
          <View style={styles.emptyState}>
            <Feather name="home" size={40} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Your feed is empty</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Post a job or browse helpers to get started
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 16 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  greeting: { fontSize: 13, fontFamily: "Inter_400Regular" },
  headTitle: { fontSize: 28, fontFamily: "Inter_700Bold" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  avatarBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  searchWrapper: { marginBottom: 16 },
  postBanner: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 16, padding: 16, marginBottom: 24 },
  postBannerTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  postBannerSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.8)", marginTop: 2 },
  sectionTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 12 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  seeAll: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  categoriesRow: { paddingBottom: 16, gap: 10 },
  categoryCard: { width: 80, alignItems: "center", borderRadius: 14, borderWidth: 1, padding: 12, gap: 8 },
  categoryIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  categoryName: { fontSize: 11, fontFamily: "Inter_500Medium", textAlign: "center" },
  helpersRow: { paddingBottom: 16 },
  loadingCenter: { alignItems: "center", gap: 10, paddingVertical: 32 },
  loadingText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  emptyState: { alignItems: "center", gap: 12, paddingVertical: 48 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
});
