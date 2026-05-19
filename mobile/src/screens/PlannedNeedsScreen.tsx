import { useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, OxSteedApiError } from "../api/client";
import type { PlannedNeedPayload } from "../api/types";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { FormInput } from "../components/FormInput";
import { Screen } from "../components/Screen";
import { AppText } from "../components/Text";
import { useJobDraftStore } from "../state/jobDraftStore";
import { colors, spacing } from "../theme";

const initialForm: PlannedNeedPayload = {
  title: "",
  description: "",
  category: "other",
  due_date: "",
  lead_time_days: 14,
  recurrence_type: "none",
  notes: ""
};

export function PlannedNeedsScreen() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<PlannedNeedPayload>(initialForm);
  const [estimatedCost, setEstimatedCost] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const setJobDraft = useJobDraftStore((state) => state.setDraft);

  const needs = useQuery({
    queryKey: ["planned-needs"],
    queryFn: api.listPlannedNeeds
  });

  const createNeed = useMutation({
    mutationFn: () =>
      api.createPlannedNeed({
        ...form,
        estimated_cost: estimatedCost ? Number(estimatedCost) : undefined,
        recurrence_interval_days: form.recurrence_type === "none" ? undefined : form.recurrence_interval_days
      }),
    onSuccess: async () => {
      setForm(initialForm);
      setEstimatedCost("");
      setStatus("Planned need saved. OxSteed will keep it visible as the due date gets closer.");
      await queryClient.invalidateQueries({ queryKey: ["planned-needs"] });
      await queryClient.invalidateQueries({ queryKey: ["mobile-feed"] });
    },
    onError: (error) => {
      setStatus(error instanceof OxSteedApiError ? error.message : "Could not create planned need.");
    }
  });

  function convertToJobDraft(title: string, description?: string, category?: string) {
    setJobDraft({
      title: title.length >= 10 ? title : `${title} service request`,
      description:
        description && description.length >= 50
          ? description
          : `${description || title}. Please include timing, access notes, photos, and the details a helper should know before quoting this planned need.`,
      category: category || "Other / Specify in Description",
      budgetMin: "",
      budgetMax: ""
    });
    setStatus("Job draft prepared. Open the Post tab to review location, photos, and budget before publishing.");
  }

  return (
    <Screen>
      <View>
        <AppText variant="caption">PLANNED NEEDS</AppText>
        <AppText variant="title">Turn future work into prepared jobs.</AppText>
      </View>

      <Card>
        <AppText variant="headline">Create a future need</AppText>
        <FormInput placeholder="Title" value={form.title} onChangeText={(title) => setForm((draft) => ({ ...draft, title }))} />
        <FormInput multiline placeholder="Description" value={form.description} onChangeText={(description) => setForm((draft) => ({ ...draft, description }))} />
        <FormInput placeholder="Category: car_care, personal_care, other" value={form.category} onChangeText={(category) => setForm((draft) => ({ ...draft, category: category === "car_care" || category === "personal_care" ? category : "other" }))} />
        <FormInput placeholder="Due date YYYY-MM-DD" value={form.due_date} onChangeText={(due_date) => setForm((draft) => ({ ...draft, due_date }))} />
        <FormInput placeholder="Estimated cost optional" value={estimatedCost} onChangeText={setEstimatedCost} keyboardType="numeric" />
        <FormInput placeholder="Lead time days" value={String(form.lead_time_days)} onChangeText={(lead) => setForm((draft) => ({ ...draft, lead_time_days: Number(lead) || 14 }))} keyboardType="numeric" />
        {status && <AppText variant="muted">{status}</AppText>}
        <Button disabled={createNeed.isPending || !form.title.trim() || !form.due_date} onPress={() => createNeed.mutate()}>
          {createNeed.isPending ? "Saving..." : "Save planned need"}
        </Button>
      </Card>

      {needs.isLoading ? <ActivityIndicator color={colors.orange} /> : null}
      {(needs.data || []).map((need) => (
        <Card key={need.id}>
          <AppText variant="headline">{need.title}</AppText>
          <AppText variant="muted">{need.description || "No description yet."}</AppText>
          <AppText variant="caption">
            {[need.category, need.status, need.due_date, need.estimated_cost ? `$${need.estimated_cost}` : null].filter(Boolean).join(" • ")}
          </AppText>
          <Button variant="secondary" onPress={() => convertToJobDraft(need.title, need.description, need.category)}>
            Convert to job draft
          </Button>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  unused: {
    gap: spacing.sm
  }
});
