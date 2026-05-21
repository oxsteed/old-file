import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

const ROLES = [
  { id: "customer", label: "Customer", icon: "user", description: "Post jobs, find helpers, pay and review" },
  { id: "helper", label: "Helper", icon: "briefcase", description: "Find jobs, submit bids, grow your reputation" },
  { id: "business", label: "Business", icon: "globe", description: "Manage services, leads, invoices, and products" },
  { id: "tool_owner", label: "Tool Owner", icon: "tool", description: "List tools for rent with rates and availability" },
] as const;

const MENU_ITEMS = [
  { icon: "star", label: "My Reviews", badge: null },
  { icon: "credit-card", label: "Payments & Billing", badge: null },
  { icon: "calendar", label: "Bookings & Schedule", badge: "3" },
  { icon: "shield", label: "Trust & Verification", badge: null },
  { icon: "bell", label: "Notifications", badge: null },
  { icon: "settings", label: "Settings", badge: null },
  { icon: "help-circle", label: "Help Center", badge: null },
];

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, logout, switchRole } = useAuth();
  const { postedJobs, savedHelpers } = useApp();
  const [switchingRole, setSwitchingRole] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const role = user?.role ?? "customer";

  const currentRole = ROLES.find((r) => r.id === role) ?? ROLES[0];

  const handleSwitchRole = async (newRole: string) => {
    if (newRole === role || switchingRole) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSwitchingRole(newRole);
    try {
      await switchRole(newRole);
    } catch {
      // role switch failed — stay on current role
    } finally {
      setSwitchingRole(null);
    }
  };

  const handleLogout = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoggingOut(true);
    try {
      await logout();
      router.replace("/login");
    } finally {
      setLoggingOut(false);
    }
  };

  const STATS = {
    customer: [
      { label: "Jobs Posted", value: String(postedJobs.length) },
      { label: "Saved Helpers", value: String(savedHelpers.length) },
      { label: "Reviews", value: "0" },
    ],
    helper: [
      { label: "Jobs Done", value: "0" },
      { label: "Rating", value: "—" },
      { label: "Bids", value: "0" },
    ],
    business: [
      { label: "Active Leads", value: "0" },
      { label: "Revenue", value: "$0" },
      { label: "Clients", value: "0" },
    ],
    tool_owner: [
      { label: "Tools Listed", value: "0" },
      { label: "Rentals", value: "0" },
      { label: "Earned", value: "$0" },
    ],
  }[role] ?? [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingTop: topPad + 16, paddingBottom: Platform.OS === "web" ? 120 : 100 }]}
      >
        {/* Profile card */}
        <View style={[styles.profileCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
            <Text style={styles.avatarText}>{(user?.name ?? "U")[0].toUpperCase()}</Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={[styles.profileName, { color: colors.foreground }]}>{user?.name ?? "—"}</Text>
            <Text style={[styles.profileEmail, { color: colors.mutedForeground }]}>{user?.email ?? "—"}</Text>
            <View style={[styles.roleBadge, { backgroundColor: colors.primary + "20" }]}>
              <Feather name={currentRole.icon as any} size={12} color={colors.primary} />
              <Text style={[styles.roleBadgeText, { color: colors.primary }]}>{currentRole.label}</Text>
            </View>
          </View>
          <TouchableOpacity style={[styles.editBtn, { borderColor: colors.border }]} activeOpacity={0.75}>
            <Feather name="edit-2" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        {/* Stats */}
        <View style={[styles.statsRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {STATS.map((stat, i) => (
            <React.Fragment key={stat.label}>
              {i > 0 && <View style={[styles.statDivider, { backgroundColor: colors.border }]} />}
              <View style={styles.stat}>
                <Text style={[styles.statValue, { color: colors.foreground }]}>{stat.value}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{stat.label}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>

        {/* Switch role */}
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Switch role</Text>
        <View style={styles.rolesGrid}>
          {ROLES.map((r) => {
            const isActive = role === r.id;
            const isSwitching = switchingRole === r.id;
            return (
              <TouchableOpacity
                key={r.id}
                style={[styles.roleCard, { backgroundColor: isActive ? colors.primary + "20" : colors.card, borderColor: isActive ? colors.primary : colors.border }]}
                onPress={() => handleSwitchRole(r.id)}
                activeOpacity={0.75}
                disabled={!!switchingRole}
              >
                {isSwitching ? (
                  <ActivityIndicator color={colors.primary} size="small" />
                ) : (
                  <Feather name={r.icon as any} size={20} color={isActive ? colors.primary : colors.mutedForeground} />
                )}
                <Text style={[styles.roleCardLabel, { color: isActive ? colors.primary : colors.foreground }]}>{r.label}</Text>
                <Text style={[styles.roleCardDesc, { color: colors.mutedForeground }]} numberOfLines={2}>{r.description}</Text>
                {isActive && (
                  <View style={[styles.activeCheck, { backgroundColor: colors.primary }]}>
                    <Feather name="check" size={10} color="#FFFFFF" />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Account menu */}
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Account</Text>
        <View style={[styles.menuList, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {MENU_ITEMS.map((item, i) => (
            <TouchableOpacity
              key={item.label}
              style={[styles.menuItem, i < MENU_ITEMS.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}
              onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
              activeOpacity={0.75}
            >
              <View style={[styles.menuIcon, { backgroundColor: colors.muted }]}>
                <Feather name={item.icon as any} size={16} color={colors.mutedForeground} />
              </View>
              <Text style={[styles.menuLabel, { color: colors.foreground }]}>{item.label}</Text>
              {item.badge && (
                <View style={[styles.badge, { backgroundColor: colors.primary }]}>
                  <Text style={styles.badgeText}>{item.badge}</Text>
                </View>
              )}
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          ))}
        </View>

        {/* Sign out */}
        <TouchableOpacity
          style={[styles.signOutBtn, { borderColor: colors.border }]}
          onPress={handleLogout}
          disabled={loggingOut}
          activeOpacity={0.75}
        >
          {loggingOut ? (
            <ActivityIndicator color="#EF4444" size="small" />
          ) : (
            <>
              <Feather name="log-out" size={16} color="#EF4444" />
              <Text style={styles.signOutText}>Sign out</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 16 },
  profileCard: { flexDirection: "row", alignItems: "center", borderRadius: 16, borderWidth: 1, padding: 16, gap: 12, marginBottom: 12 },
  avatar: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  profileInfo: { flex: 1, gap: 3 },
  profileName: { fontSize: 18, fontFamily: "Inter_700Bold" },
  profileEmail: { fontSize: 13, fontFamily: "Inter_400Regular" },
  roleBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, alignSelf: "flex-start", marginTop: 2 },
  roleBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  editBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  statsRow: { flexDirection: "row", borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 24 },
  stat: { flex: 1, alignItems: "center" },
  statDivider: { width: 1, marginVertical: 4 },
  statValue: { fontSize: 20, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2, textAlign: "center" },
  sectionTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 12 },
  rolesGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 24 },
  roleCard: { width: "47%", borderWidth: 1, borderRadius: 14, padding: 14, gap: 4, position: "relative" },
  roleCardLabel: { fontSize: 14, fontFamily: "Inter_700Bold", marginTop: 4 },
  roleCardDesc: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16 },
  activeCheck: { position: "absolute", top: 10, right: 10, width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  menuList: { borderRadius: 16, borderWidth: 1, marginBottom: 12 },
  menuItem: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  menuIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  menuLabel: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium" },
  badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  badgeText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  signOutBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderRadius: 14, paddingVertical: 14, marginTop: 8 },
  signOutText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#EF4444" },
});
