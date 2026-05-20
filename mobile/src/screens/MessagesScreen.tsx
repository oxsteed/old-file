import { useMemo, useState } from "react";
import { ActivityIndicator, Image, StyleSheet, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, OxSteedApiError } from "../api/client";
import type { Conversation, Message } from "../api/types";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { FormInput } from "../components/FormInput";
import { Screen } from "../components/Screen";
import { AppText } from "../components/Text";
import { useAuthStore } from "../state/authStore";
import { colors, spacing } from "../theme";

function conversationTitle(conversation: Conversation) {
  return conversation.conversation_business_name || conversation.helper_business_name || conversation.other_user_name || "OxSteed conversation";
}

export function MessagesScreen() {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [body, setBody] = useState("");
  const [attachment, setAttachment] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const conversations = useQuery({
    queryKey: ["conversations"],
    queryFn: api.listConversations,
    refetchInterval: 15_000
  });

  const messages = useQuery({
    queryKey: ["messages", activeConversation?.id],
    enabled: Boolean(activeConversation),
    queryFn: () => api.getMessages(activeConversation!.id),
    refetchInterval: activeConversation ? 7_500 : false
  });

  const optimisticMessages = useMemo(() => messages.data || [], [messages.data]);

  const send = useMutation({
    mutationFn: async () => {
      if (!activeConversation) return null;
      let content = body.trim();
      if (attachment) {
        const uploaded = await api.uploadMessageAttachment(activeConversation.id, attachment);
        content = `${content}${content ? "\n\n" : ""}${uploaded.url}`;
      }
      return api.sendMessage(activeConversation.id, content);
    },
    onMutate: async () => {
      if (!activeConversation || !body.trim()) return;
      await queryClient.cancelQueries({ queryKey: ["messages", activeConversation.id] });
      const previous = queryClient.getQueryData<Message[]>(["messages", activeConversation.id]) || [];
      const pending: Message = {
        id: `pending-${Date.now()}`,
        conversation_id: activeConversation.id,
        sender_id: user?.id || "me",
        sender_name: "You",
        content: body.trim(),
        created_at: new Date().toISOString(),
        pending: true
      };
      queryClient.setQueryData(["messages", activeConversation.id], [...previous, pending]);
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (activeConversation && context?.previous) {
        queryClient.setQueryData(["messages", activeConversation.id], context.previous);
      }
      setStatus(error instanceof OxSteedApiError ? error.message : "Could not send message.");
    },
    onSuccess: async () => {
      setBody("");
      setAttachment(null);
      setStatus(null);
      await queryClient.invalidateQueries({ queryKey: ["messages", activeConversation?.id] });
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      await queryClient.invalidateQueries({ queryKey: ["mobile-feed"] });
    }
  });

  async function pickAttachment() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setStatus("Photo permission is needed to attach an image.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.82
    });
    if (!result.canceled) {
      setAttachment(result.assets[0]);
    }
  }

  if (activeConversation) {
    return (
      <Screen>
        <Button variant="secondary" onPress={() => setActiveConversation(null)}>Back to inbox</Button>
        <Card>
          <AppText variant="headline">{conversationTitle(activeConversation)}</AppText>
          <AppText variant="caption">{activeConversation.job_title || "Profile or booking conversation"}</AppText>
        </Card>
        {messages.isLoading ? <ActivityIndicator color={colors.orange} /> : null}
        {optimisticMessages.map((message) => {
          const mine = String(message.sender_id) === String(user?.id) || message.pending;
          return (
            <View key={String(message.id)} style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
              <AppText>{message.content}</AppText>
              <AppText variant="caption">{message.pending ? "Sending..." : message.sender_name || (mine ? "You" : "Helper")}</AppText>
            </View>
          );
        })}
        <Card>
          <FormInput multiline placeholder="Write a message" value={body} onChangeText={setBody} />
          {attachment && <Image source={{ uri: attachment.uri }} style={styles.attachment} />}
          {status && <AppText variant="muted">{status}</AppText>}
          <View style={styles.actions}>
            <Button variant="secondary" onPress={pickAttachment}>Attach image</Button>
            <Button disabled={send.isPending || (!body.trim() && !attachment)} onPress={() => send.mutate()}>
              {send.isPending ? "Sending..." : "Send"}
            </Button>
          </View>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <View>
        <AppText variant="caption">MESSAGES</AppText>
        <AppText variant="title">Keep every hire in one thread.</AppText>
      </View>
      {conversations.isLoading ? <ActivityIndicator color={colors.orange} /> : null}
      {(conversations.data || []).map((conversation) => (
        <Card key={String(conversation.id)}>
          <AppText variant="headline">{conversationTitle(conversation)}</AppText>
          <AppText variant="muted">{conversation.last_message || "No messages yet."}</AppText>
          <AppText variant="caption">
            {[conversation.job_title, Number(conversation.unread_count || 0) ? `${conversation.unread_count} unread` : null].filter(Boolean).join(" • ")}
          </AppText>
          <Button onPress={() => setActiveConversation(conversation)}>Open thread</Button>
        </Card>
      ))}
      {conversations.data?.length === 0 && (
        <Card>
          <AppText variant="headline">No conversations yet</AppText>
          <AppText variant="muted">Message a helper from the Helpers tab or start from a job/booking.</AppText>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  bubble: {
    maxWidth: "86%",
    padding: spacing.md,
    borderRadius: 8,
    gap: spacing.xs
  },
  mine: {
    alignSelf: "flex-end",
    backgroundColor: colors.orange
  },
  theirs: {
    alignSelf: "flex-start",
    backgroundColor: colors.panel
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm
  },
  attachment: {
    width: 96,
    height: 96,
    borderRadius: 8
  }
});
