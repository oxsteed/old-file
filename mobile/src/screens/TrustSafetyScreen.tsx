import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { Alert, Image, StyleSheet, View } from "react-native";
import { api, OxSteedApiError } from "../api/client";
import type { MobileJob } from "../api/types";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { FormInput } from "../components/FormInput";
import { Screen } from "../components/Screen";
import { AppText } from "../components/Text";
import { colors, spacing } from "../theme";

const disputeReasons = ["work_not_completed", "poor_quality", "no_show", "overcharged", "property_damage", "safety_concern", "fraud", "other"];

function describeError(error: unknown) {
  if (error instanceof OxSteedApiError || error instanceof Error) return error.message;
  return "Please try again.";
}

export function TrustSafetyScreen() {
  const queryClient = useQueryClient();
  const [selectedJob, setSelectedJob] = useState<MobileJob | null>(null);
  const [reason, setReason] = useState(disputeReasons[0]);
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<ImagePicker.ImagePickerAsset[]>([]);

  const feed = useQuery({ queryKey: ["mobile-feed"], queryFn: api.mobileFeed, refetchInterval: 30_000 });
  const notifications = useQuery({ queryKey: ["notifications"], queryFn: api.notifications, refetchInterval: 20_000 });
  const disputes = useQuery({ queryKey: ["disputes"], queryFn: api.listDisputes, refetchInterval: 30_000 });

  const openDispute = useMutation({
    mutationFn: async () => {
      if (!selectedJob) throw new Error("Choose a job first.");
      const opened = await api.openDispute(selectedJob.id, { reason, description });
      const disputeId = opened.dispute?.id;
      if (disputeId && photos.length) {
        await api.submitDisputeEvidence(disputeId, photos, "Evidence uploaded from mobile.");
      }
      return opened;
    },
    onSuccess: async () => {
      setSelectedJob(null);
      setDescription("");
      setPhotos([]);
      await queryClient.invalidateQueries({ queryKey: ["disputes"] });
      Alert.alert("Dispute filed", "OxSteed has your dispute and supporting context.");
    },
    onError: (error) => Alert.alert("Dispute not filed", describeError(error))
  });

  async function pickEvidence() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", "Photo permission is needed to attach evidence.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.82
    });
    if (!result.canceled) setPhotos(result.assets.slice(0, 5));
  }

  const jobs = feed.data?.jobs.mine || [];

  return (
    <Screen>
      <View>
        <AppText variant="caption">TRUST & SAFETY</AppText>
        <AppText variant="title">Disputes, alerts, and profile trust signals.</AppText>
      </View>

      <Card>
        <AppText variant="headline">Notifications center</AppText>
        <AppText variant="caption">{notifications.data?.unread_count || 0} unread</AppText>
        {(notifications.data?.notifications || []).slice(0, 8).map((item) => (
          <View key={String(item.id)} style={styles.row}>
            <AppText>{item.title || item.type || "OxSteed update"}</AppText>
            <AppText variant="muted">{item.body || item.message || item.action_url || "System notification"}</AppText>
            <AppText variant="caption">{item.is_read ? "Read" : "Unread"}</AppText>
          </View>
        ))}
        <Button variant="secondary" onPress={() => api.markNotificationsRead("all").then(() => notifications.refetch())}>
          Mark all read
        </Button>
      </Card>

      <Card>
        <AppText variant="headline">File a dispute</AppText>
        {jobs.map((job) => (
          <Button key={job.id} variant={selectedJob?.id === job.id ? "primary" : "secondary"} onPress={() => setSelectedJob(job)}>
            {job.title}
          </Button>
        ))}
        <Button variant="secondary" onPress={() => setReason(disputeReasons[(disputeReasons.indexOf(reason) + 1) % disputeReasons.length])}>
          Reason: {reason.replace(/_/g, " ")}
        </Button>
        <FormInput multiline placeholder="Explain what happened, including dates, payment context, and what resolution you want." value={description} onChangeText={setDescription} />
        <View style={styles.photos}>
          {photos.map((photo) => <Image key={photo.uri} source={{ uri: photo.uri }} style={styles.photo} />)}
        </View>
        <Button variant="secondary" onPress={pickEvidence}>Attach photo evidence</Button>
        <Button disabled={!selectedJob || description.trim().length < 20 || openDispute.isPending} onPress={() => openDispute.mutate()}>
          File dispute
        </Button>
      </Card>

      <Card>
        <AppText variant="headline">My disputes</AppText>
        {(disputes.data || []).map((dispute) => (
          <View key={String(dispute.id)} style={styles.row}>
            <AppText>{dispute.job_title || `Dispute ${dispute.id}`}</AppText>
            <AppText variant="caption">{[dispute.reason, dispute.status].filter(Boolean).join(" - ")}</AppText>
          </View>
        ))}
        {disputes.data?.length === 0 && <AppText variant="muted">No active disputes.</AppText>}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border
  },
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
