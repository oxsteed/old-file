import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useMemo, useState } from "react";
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
import { useHelpers, useJobs } from "@/hooks/useApi";
import { useColors } from "@/hooks/useColors";

type Tab = "jobs" | "helpers";
type Filter = "all" | "Tutoring" | "Cleaning" | "Handyman" | "Lawn Care" | "Pet Care" | "Moving";

const FILTERS: Filter[] = ["all", "Tutoring", "Cleaning", "Handyman", "Lawn Care", "Pet Care", "Moving"];

export default function BrowseScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<Tab>("jobs");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const {
    data: jobs = [],
    isLoading: jobsLoading,
    refetch: refetchJobs,
    isRefetching: jobsRefetching,
  } = useJobs(filter !== "all" ? { category: filter } : undefined);

  const {
    data: helpers = [],
    isLoading: helpersLoading,
    refetch: refetchHelpers,
    isRefetching: helpersRefetching,
  } = useHelpers(search ? { search } : undefined);

  const filteredJobs = useMemo(() => {
    if (!search) return jobs;
    const q = search.toLowerCase();
    return (jobs as any[]).filter(
      (j: any) =>
        j.title?.toLowerCase().includes(q) ||
        j.category?.toLowerCase().includes(q) ||
        j.description?.toLowerCase().includes(q)
    );
  }, [jobs, search]);

  const filteredHelpers = useMemo(() => {
    if (!search) return helpers;
    const q = search.toLowerCase();
    return (helpers as any[]).filter(
      (h: any) =>
        h.name?.toLowerCase().includes(q) ||
        h.displayName?.toLowerCase().includes(q) ||
        (h.skills ?? []).some((s: string) => s.toLowerCase().includes(q))
    );
  }, [helpers, search]);

  const isLoading = activeTab === "jobs" ? jobsLoading : helpersLoading;
  const isRefreshing = activeTab === "jobs" ? jobsRefetching : helpersRefetching;

  const switchTab = (tab: Tab) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveTab(tab);
    setFilter("all");
    setSearch("");
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 16, backgroundColor: colors.background }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Browse</Text>

        <View style={[styles.toggle, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {(["jobs", "helpers"] as Tab[]).map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.toggleBtn, activeTab === tab && { backgroundColor: colors.primary }]}
              onPress={() => switchTab(tab)}
              activeOpacity={0.8}
            >
              <Text style={[styles.toggleText, { color: activeTab === tab ? "#FFFFFF" : colors.mutedForeground }]}>
                {tab === "jobs" ? "Jobs" : "Helpers"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder={activeTab === "jobs" ? "Search jobs..." : "Search helpers..."}
          onClear={() => setSearch("")}
        />

        {activeTab === "jobs" && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtersRow}>
            {FILTERS.map((f) => (
              <TouchableOpacity
                key={f}
                style={[
                  styles.filterPill,
                  {
                    backgroundColor: filter === f ? colors.primary : colors.card,
                    borderColor: filter === f ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setFilter(f);
                }}
                activeOpacity={0.75}
              >
                <Text style={[styles.filterText, { color: filter === f ? "#FFFFFF" : colors.mutedForeground }]}>
                  {f === "all" ? "All" : f}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        <Text style={[styles.resultText, { color: colors.mutedForeground }]}>
          {isLoading
            ? "Loading…"
            : `${activeTab === "jobs" ? filteredJobs.length : filteredHelpers.length} ${activeTab === "jobs" ? "jobs" : "helpers"} found`}
        </Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={activeTab === "jobs" ? refetchJobs : refetchHelpers}
            tintColor={colors.primary}
          />
        }
        contentContainerStyle={[styles.list, { paddingBottom: Platform.OS === "web" ? 120 : 100 }]}
      >
        {isLoading ? (
          <View style={styles.loadingCenter}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        ) : activeTab === "jobs" ? (
          (filteredJobs as any[]).length > 0 ? (
            (filteredJobs as any[]).map((job: any) => <JobCard key={job.id} job={job} />)
          ) : (
            <View style={styles.empty}>
              <Feather name="search" size={40} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No jobs found</Text>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                Try adjusting your search or filters
              </Text>
            </View>
          )
        ) : (filteredHelpers as any[]).length > 0 ? (
          (filteredHelpers as any[]).map((helper: any) => <HelperCard key={helper.id} helper={helper} />)
        ) : (
          <View style={styles.empty}>
            <Feather name="users" size={40} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No helpers found</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Try a different search term
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 4 },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", marginBottom: 14 },
  toggle: { flexDirection: "row", borderRadius: 12, borderWidth: 1, padding: 4, marginBottom: 12 },
  toggleBtn: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: "center" },
  toggleText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  filtersRow: { paddingVertical: 10, gap: 8 },
  filterPill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  filterText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  resultText: { fontSize: 12, fontFamily: "Inter_400Regular", paddingVertical: 6 },
  list: { paddingHorizontal: 16, paddingTop: 8 },
  loadingCenter: { alignItems: "center", paddingVertical: 60 },
  empty: { alignItems: "center", justifyContent: "center", paddingVertical: 60, gap: 12 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
});
