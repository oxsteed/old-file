import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
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

import { SearchBar } from "@/components/SearchBar";
import { useConversations } from "@/hooks/useApi";
import { useColors } from "@/hooks/useColors";

function timeAgo(dateStr?: string): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const AVATAR_COLORS = ["#3B82F6", "#10B981", "#F97316", "#8B5CF6", "#EC4899", "#06B6D4"];

function getColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name?: string): string {
  if (!name) return "?";
  return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

function ConversationRow({ conv }: { conv: any }) {
  const colors = useColors();
  const contactName = conv.contactName ?? conv.participant?.name ?? conv.helperName ?? "Unknown";
  const initials = getInitials(contactName);
  const color = getColor(conv.id);
  const unread = conv.unreadCount ?? conv.unread ?? 0;
  const lastMsg = conv.lastMessage ?? conv.lastMessagePreview ?? "";
  const ts = conv.lastMessageAt ?? conv.updatedAt ?? conv.timestamp;
  const jobTitle = conv.jobTitle ?? conv.job?.title ?? "";

  return (
    <TouchableOpacity
      style={[styles.messageRow, { borderBottomColor: colors.border }]}
      onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
      activeOpacity={0.75}
    >
      <View style={[styles.avatar, { backgroundColor: color }]}>
        <Text style={styles.avatarText}>{initials}</Text>
        {unread > 0 && (
          <View style={[styles.unreadDot, { backgroundColor: "#F97316" }]}>
            <Text style={styles.unreadCount}>{unread}</Text>
          </View>
        )}
      </View>
      <View style={styles.messageContent}>
        <View style={styles.messageHeader}>
          <Text style={[styles.contactName, { color: colors.foreground }]}>{contactName}</Text>
          <Text style={[styles.timestamp, { color: colors.mutedForeground }]}>{timeAgo(ts)}</Text>
        </View>
        {!!jobTitle && (
          <Text style={[styles.jobTitle, { color: colors.primary }]} numberOfLines={1}>{jobTitle}</Text>
        )}
        <Text
          style={[styles.lastMessage, { color: unread > 0 ? colors.foreground : colors.mutedForeground, fontFamily: unread > 0 ? "Inter_500Medium" : "Inter_400Regular" }]}
          numberOfLines={1}
        >
          {lastMsg}
        </Text>
      </View>
      <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
    </TouchableOpacity>
  );
}

export default function MessagesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const { data: conversations = [], isLoading, refetch, isRefetching } = useConversations();

  const filtered = (conversations as any[]).filter((c: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const name = (c.contactName ?? c.participant?.name ?? "").toLowerCase();
    const msg = (c.lastMessage ?? "").toLowerCase();
    return name.includes(q) || msg.includes(q);
  });

  const totalUnread = (conversations as any[]).reduce((sum: number, c: any) => sum + (c.unreadCount ?? c.unread ?? 0), 0);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 16, backgroundColor: colors.background }]}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: colors.foreground }]}>Messages</Text>
          {totalUnread > 0 && (
            <View style={[styles.totalBadge, { backgroundColor: colors.primary }]}>
              <Text style={styles.totalBadgeText}>{totalUnread}</Text>
            </View>
          )}
        </View>
        <SearchBar value={search} onChangeText={setSearch} placeholder="Search conversations..." onClear={() => setSearch("")} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
        contentContainerStyle={[styles.list, { paddingBottom: Platform.OS === "web" ? 120 : 100 }]}
      >
        {isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        ) : filtered.length > 0 ? (
          filtered.map((conv: any) => <ConversationRow key={conv.id} conv={conv} />)
        ) : (
          <View style={styles.empty}>
            <Feather name="message-circle" size={40} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              {search ? "No results" : "No messages yet"}
            </Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              {search ? "No conversations match your search" : "Post a job or book a helper to start a conversation"}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
  title: { fontSize: 28, fontFamily: "Inter_700Bold" },
  totalBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  totalBadgeText: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  list: {},
  center: { alignItems: "center", paddingVertical: 60 },
  messageRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, gap: 12 },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", position: "relative" },
  avatarText: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  unreadDot: { position: "absolute", top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  unreadCount: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  messageContent: { flex: 1, gap: 2 },
  messageHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  contactName: { fontSize: 15, fontFamily: "Inter_700Bold" },
  timestamp: { fontSize: 11, fontFamily: "Inter_400Regular" },
  jobTitle: { fontSize: 12, fontFamily: "Inter_500Medium" },
  lastMessage: { fontSize: 13, lineHeight: 18 },
  empty: { alignItems: "center", justifyContent: "center", paddingVertical: 80, gap: 12, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
});
