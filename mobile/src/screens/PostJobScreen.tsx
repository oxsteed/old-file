import { useState } from "react";
import { StyleSheet, TextInput } from "react-native";
import { api, OxSteedApiError } from "../api/client";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Screen } from "../components/Screen";
import { AppText } from "../components/Text";
import { colors, radius, spacing } from "../theme";

export function PostJobScreen() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [budgetMin, setBudgetMin] = useState("");
  const [budgetMax, setBudgetMax] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function submit() {
    setIsSaving(true);
    setStatus(null);
    try {
      await api.postJob({
        title: title.trim(),
        description: description.trim(),
        category_name: category.trim() || "General",
        budget_type: "fixed",
        budget_min: Number(budgetMin) || undefined,
        budget_max: Number(budgetMax) || undefined,
        urgency: "normal",
        location_city: city.trim(),
        location_state: state.trim() || undefined,
        location_country: "US"
      });
      setStatus("Job posted. It will now be visible to matching helpers.");
      setTitle("");
      setDescription("");
      setCategory("");
      setCity("");
      setState("");
      setBudgetMin("");
      setBudgetMax("");
    } catch (error) {
      setStatus(error instanceof OxSteedApiError ? error.message : "Could not post this job.");
    } finally {
      setIsSaving(false);
    }
  }

  const canSubmit = title.trim().length >= 10 && description.trim().length >= 50 && Boolean(city.trim());

  return (
    <Screen>
      <AppText variant="caption">PHASE 2 START</AppText>
      <AppText variant="title">Post a job</AppText>
      <AppText variant="muted">
        This is the first mobile transaction form. Later passes will split it into
        the full multi-step customer wizard with media, maps, and saved drafts.
      </AppText>

      <Card>
        <TextInput style={styles.input} placeholder="Job title, at least 10 characters" placeholderTextColor={colors.muted} value={title} onChangeText={setTitle} />
        <TextInput
          multiline
          style={[styles.input, styles.multiline]}
          placeholder="Describe the work, at least 50 characters"
          placeholderTextColor={colors.muted}
          value={description}
          onChangeText={setDescription}
        />
        <TextInput style={styles.input} placeholder="Category" placeholderTextColor={colors.muted} value={category} onChangeText={setCategory} />
        <TextInput style={styles.input} placeholder="City" placeholderTextColor={colors.muted} value={city} onChangeText={setCity} />
        <TextInput style={styles.input} placeholder="State optional" placeholderTextColor={colors.muted} value={state} onChangeText={setState} />
        <TextInput style={styles.input} placeholder="Minimum budget optional" placeholderTextColor={colors.muted} value={budgetMin} onChangeText={setBudgetMin} keyboardType="numeric" />
        <TextInput style={styles.input} placeholder="Maximum budget optional" placeholderTextColor={colors.muted} value={budgetMax} onChangeText={setBudgetMax} keyboardType="numeric" />
        {status && <AppText variant="muted">{status}</AppText>}
        <Button disabled={isSaving || !canSubmit} onPress={submit}>
          {isSaving ? "Posting..." : "Post job"}
        </Button>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    color: colors.text,
    backgroundColor: colors.background
  },
  multiline: {
    minHeight: 120,
    paddingTop: spacing.md,
    textAlignVertical: "top"
  }
});
