import { useEffect, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { api, OxSteedApiError } from "../api/client";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { FormInput } from "../components/FormInput";
import { Screen } from "../components/Screen";
import { AppText } from "../components/Text";
import { useJobDraftStore } from "../state/jobDraftStore";
import { spacing } from "../theme";

export function PostJobScreen() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [budgetMin, setBudgetMin] = useState("");
  const [budgetMax, setBudgetMax] = useState("");
  const [photos, setPhotos] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const { draft, clearDraft } = useJobDraftStore();

  useEffect(() => {
    if (!draft) return;
    setTitle(draft.title);
    setDescription(draft.description);
    setCategory(draft.category);
    setBudgetMin(draft.budgetMin);
    setBudgetMax(draft.budgetMax);
    setStatus("Draft loaded from Planned Needs. Add location details, then post when ready.");
    clearDraft();
  }, [draft, clearDraft]);

  async function pickPhotos() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setStatus("Photo permission is needed to attach job images.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.82,
      selectionLimit: 6
    });
    if (!result.canceled) {
      setPhotos(result.assets.slice(0, 6));
    }
  }

  async function submit() {
    setIsSaving(true);
    setStatus(null);
    try {
      await api.postJobWithPhotos({
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
      }, photos);
      setStatus("Job posted. It will now be visible to matching helpers.");
      setTitle("");
      setDescription("");
      setCategory("");
      setCity("");
      setState("");
      setBudgetMin("");
      setBudgetMax("");
      setPhotos([]);
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
        Step through the basics helpers need first: category, scope, photos,
        location, and budget. This writes to the same job endpoint as the web app.
      </AppText>

      <Card>
        <AppText variant="caption">1. Scope</AppText>
        <FormInput placeholder="Job title, at least 10 characters" value={title} onChangeText={setTitle} />
        <FormInput
          multiline
          placeholder="Describe the work, at least 50 characters"
          value={description}
          onChangeText={setDescription}
        />

        <AppText variant="caption">2. Category and photos</AppText>
        <FormInput placeholder="Category" value={category} onChangeText={setCategory} />
        <Button variant="secondary" onPress={pickPhotos}>
          {photos.length ? `Change photos (${photos.length})` : "Add photos"}
        </Button>
        {photos.length > 0 && (
          <View style={styles.photos}>
            {photos.map((photo) => (
              <Image key={photo.assetId || photo.uri} source={{ uri: photo.uri }} style={styles.photo} />
            ))}
          </View>
        )}

        <AppText variant="caption">3. Location and budget</AppText>
        <FormInput placeholder="City" value={city} onChangeText={setCity} />
        <FormInput placeholder="State optional" value={state} onChangeText={setState} />
        <FormInput placeholder="Minimum budget optional" value={budgetMin} onChangeText={setBudgetMin} keyboardType="numeric" />
        <FormInput placeholder="Maximum budget optional" value={budgetMax} onChangeText={setBudgetMax} keyboardType="numeric" />
        {status && <AppText variant="muted">{status}</AppText>}
        <Button disabled={isSaving || !canSubmit} onPress={submit}>
          {isSaving ? "Posting..." : "Post job"}
        </Button>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  photos: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  photo: {
    width: 72,
    height: 72,
    borderRadius: 8
  }
});
