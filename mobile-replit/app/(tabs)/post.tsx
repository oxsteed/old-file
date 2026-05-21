import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { useCreateJob } from "@/hooks/useApi";
import { useColors } from "@/hooks/useColors";

const CATEGORIES = [
  "Tutoring", "Cleaning", "Handyman", "Lawn Care",
  "Pet Care", "Moving", "Tool Rental", "Delivery", "Events", "Other",
];

const BUDGET_OPTIONS = [
  "< $50", "$50–100", "$100–200", "$200–500", "$500+", "Hourly — discuss",
];

export default function PostScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { addPostedJob } = useApp();
  const createJobMutation = useCreateJob();

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [budget, setBudget] = useState("");
  const [location, setLocation] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [createdJob, setCreatedJob] = useState<any>(null);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const role = user?.role ?? "customer";

  const isValid = title.trim() && category && description.trim() && budget && location.trim();

  const handleSubmit = async () => {
    if (!isValid || createJobMutation.isPending) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const job = await createJobMutation.mutateAsync({
        title: title.trim(),
        category,
        description: description.trim(),
        budget,
        location: location.trim(),
        urgent,
      });
      addPostedJob({
        id: job.id ?? Date.now().toString(),
        title: job.title ?? title.trim(),
        category: job.category ?? category,
        description: job.description ?? description.trim(),
        budget: job.budget ?? budget,
        location: job.location ?? location.trim(),
        postedAt: "just now",
      });
      setCreatedJob(job);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSubmitted(true);
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handleReset = () => {
    setTitle(""); setCategory(""); setDescription("");
    setBudget(""); setLocation(""); setUrgent(false);
    setSubmitted(false); setCreatedJob(null);
    createJobMutation.reset();
  };

  if (submitted) {
    return (
      <View style={[styles.container, styles.successContainer, { backgroundColor: colors.background }]}>
        <View style={[styles.successIcon, { backgroundColor: colors.primary + "20" }]}>
          <Feather name="check-circle" size={48} color={colors.primary} />
        </View>
        <Text style={[styles.successTitle, { color: colors.foreground }]}>Job posted!</Text>
        <Text style={[styles.successSub, { color: colors.mutedForeground }]}>
          Helpers near you have been notified and can start submitting bids.
        </Text>
        <View style={[styles.successCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.successJobTitle, { color: colors.foreground }]}>{createdJob?.title ?? title}</Text>
          <Text style={[styles.successCategory, { color: colors.primary }]}>{createdJob?.category ?? category}</Text>
          <Text style={[styles.successBudget, { color: colors.mutedForeground }]}>{createdJob?.budget ?? budget}</Text>
        </View>
        <TouchableOpacity style={[styles.postAnotherBtn, { backgroundColor: colors.primary }]} onPress={handleReset} activeOpacity={0.85}>
          <Feather name="plus" size={18} color="#FFFFFF" />
          <Text style={styles.postAnotherText}>Post another job</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (role === "helper") {
    return (
      <View style={[styles.container, styles.successContainer, { backgroundColor: colors.background }]}>
        <View style={[styles.successIcon, { backgroundColor: colors.primary + "20" }]}>
          <Feather name="user-check" size={48} color={colors.primary} />
        </View>
        <Text style={[styles.successTitle, { color: colors.foreground }]}>You're a helper</Text>
        <Text style={[styles.successSub, { color: colors.mutedForeground }]}>
          Switch to a Customer account to post jobs, or browse open jobs to start earning.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scroll, { paddingTop: topPad + 16, paddingBottom: Platform.OS === "web" ? 120 : 100 }]}
      >
        <Text style={[styles.pageTitle, { color: colors.foreground }]}>Post a Job</Text>
        <Text style={[styles.pageSub, { color: colors.mutedForeground }]}>
          Describe what you need — helpers will bid within minutes.
        </Text>

        {createJobMutation.isError && (
          <View style={[styles.errorBox, { backgroundColor: "#EF444420", borderColor: "#EF4444" }]}>
            <Feather name="alert-circle" size={14} color="#EF4444" />
            <Text style={styles.errorText}>
              {(createJobMutation.error as any)?.response?.data?.message ?? "Failed to post job. Please try again."}
            </Text>
          </View>
        )}

        <Text style={[styles.label, { color: colors.foreground }]}>Job title *</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
          value={title} onChangeText={setTitle}
          placeholder="e.g. Deep house cleaning, Math tutoring..."
          placeholderTextColor={colors.mutedForeground}
          returnKeyType="next"
        />

        <Text style={[styles.label, { color: colors.foreground }]}>Category *</Text>
        <View style={styles.pillGrid}>
          {CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat}
              style={[styles.categoryPill, { backgroundColor: category === cat ? colors.primary : colors.card, borderColor: category === cat ? colors.primary : colors.border }]}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setCategory(cat); }}
              activeOpacity={0.75}
            >
              <Text style={[styles.categoryPillText, { color: category === cat ? "#FFFFFF" : colors.mutedForeground }]}>{cat}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.label, { color: colors.foreground }]}>Description *</Text>
        <TextInput
          style={[styles.textarea, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
          value={description} onChangeText={setDescription}
          placeholder="Describe what you need in detail — timing, location, specific requirements..."
          placeholderTextColor={colors.mutedForeground}
          multiline numberOfLines={4} textAlignVertical="top"
        />

        <Text style={[styles.label, { color: colors.foreground }]}>Budget *</Text>
        <View style={styles.pillGrid}>
          {BUDGET_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt}
              style={[styles.categoryPill, { backgroundColor: budget === opt ? colors.primary : colors.card, borderColor: budget === opt ? colors.primary : colors.border }]}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setBudget(opt); }}
              activeOpacity={0.75}
            >
              <Text style={[styles.categoryPillText, { color: budget === opt ? "#FFFFFF" : colors.mutedForeground }]}>{opt}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.label, { color: colors.foreground }]}>Location *</Text>
        <View style={styles.locationInputRow}>
          <Feather name="map-pin" size={16} color={colors.mutedForeground} style={styles.locationIcon} />
          <TextInput
            style={[styles.locationInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            value={location} onChangeText={setLocation}
            placeholder="City, neighborhood, or zip code"
            placeholderTextColor={colors.mutedForeground}
            returnKeyType="done"
          />
        </View>

        <TouchableOpacity
          style={[styles.urgentToggle, { backgroundColor: colors.card, borderColor: urgent ? "#EF4444" : colors.border }]}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setUrgent((v) => !v); }}
          activeOpacity={0.8}
        >
          <View>
            <Text style={[styles.urgentTitle, { color: colors.foreground }]}>Mark as urgent</Text>
            <Text style={[styles.urgentSub, { color: colors.mutedForeground }]}>Increases visibility — helpers respond faster</Text>
          </View>
          <View style={[styles.toggleSwitch, { backgroundColor: urgent ? "#EF4444" : colors.muted }]}>
            <View style={[styles.toggleThumb, { left: urgent ? 20 : 2 }]} />
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: isValid && !createJobMutation.isPending ? colors.primary : colors.muted }]}
          onPress={handleSubmit}
          disabled={!isValid || createJobMutation.isPending}
          activeOpacity={0.85}
        >
          {createJobMutation.isPending ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <>
              <Feather name="send" size={18} color={isValid ? "#FFFFFF" : colors.mutedForeground} />
              <Text style={[styles.submitText, { color: isValid ? "#FFFFFF" : colors.mutedForeground }]}>Post Job</Text>
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
  successContainer: { alignItems: "center", justifyContent: "center", padding: 32, gap: 16 },
  pageTitle: { fontSize: 28, fontFamily: "Inter_700Bold", marginBottom: 4 },
  pageSub: { fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 24 },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 12 },
  errorText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#EF4444", flex: 1 },
  label: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontFamily: "Inter_400Regular", marginBottom: 20 },
  textarea: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontFamily: "Inter_400Regular", marginBottom: 20, minHeight: 100 },
  pillGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 },
  categoryPill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  categoryPillText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  locationInputRow: { position: "relative", marginBottom: 20 },
  locationIcon: { position: "absolute", left: 14, top: 14, zIndex: 1 },
  locationInput: { borderWidth: 1, borderRadius: 12, paddingLeft: 38, paddingRight: 14, paddingVertical: 12, fontSize: 15, fontFamily: "Inter_400Regular" },
  urgentToggle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 24 },
  urgentTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  urgentSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  toggleSwitch: { width: 44, height: 26, borderRadius: 13, position: "relative", justifyContent: "center" },
  toggleThumb: { position: "absolute", width: 22, height: 22, borderRadius: 11, backgroundColor: "#FFFFFF" },
  submitBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, paddingVertical: 16 },
  submitText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  successIcon: { width: 96, height: 96, borderRadius: 48, alignItems: "center", justifyContent: "center" },
  successTitle: { fontSize: 28, fontFamily: "Inter_700Bold" },
  successSub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 21 },
  successCard: { width: "100%", borderWidth: 1, borderRadius: 16, padding: 16, gap: 4 },
  successJobTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  successCategory: { fontSize: 13, fontFamily: "Inter_500Medium" },
  successBudget: { fontSize: 13, fontFamily: "Inter_400Regular" },
  postAnotherBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 14 },
  postAnotherText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
});
