import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, Image, StyleSheet, View } from "react-native";
import { api } from "../api/client";
import type { ToolRental } from "../api/types";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { FormInput } from "../components/FormInput";
import { MetricGrid } from "../components/MetricGrid";
import { Screen } from "../components/Screen";
import { AppText } from "../components/Text";
import { useI18n } from "../i18n";
import { colors, spacing } from "../theme";

export function ToolRentalsScreen() {
  const { t, formatCurrency } = useI18n();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({ name: "", city: "", category: "" });
  const [selectedTool, setSelectedTool] = useState<ToolRental | null>(null);
  const [dates, setDates] = useState({ startDate: "", endDate: "" });

  const tools = useQuery({
    queryKey: ["tool-rentals", filters],
    queryFn: () => api.browseTools({ ...filters, limit: 30 })
  });
  const bookings = useQuery({ queryKey: ["tool-bookings"], queryFn: api.myToolBookings });
  const nearby = useQuery({ queryKey: ["mobile-nearby", filters.city, filters.category, filters.name], queryFn: () => api.nearby({ city: filters.city, category: filters.category, q: filters.name, limit: 10 }) });

  const bookTool = useMutation({
    mutationFn: async () => {
      if (!selectedTool) throw new Error(t("tools.search"));
      return api.createToolBooking({
        toolId: selectedTool.id,
        startDate: dates.startDate,
        endDate: dates.endDate,
        renterAgreementAccepted: true
      });
    },
    onSuccess: async () => {
      Alert.alert(t("tools.requested"), t("tools.requestedBody"));
      setSelectedTool(null);
      setDates({ startDate: "", endDate: "" });
      await queryClient.invalidateQueries({ queryKey: ["tool-bookings"] });
    },
    onError: (error) => Alert.alert(t("tools.requestFailed"), error instanceof Error ? error.message : t("common.retry"))
  });

  const records = tools.data?.tools || [];

  return (
    <Screen>
      <View>
        <AppText variant="caption">{t("tools.caption")}</AppText>
        <AppText variant="title">{t("tools.title")}</AppText>
      </View>

      <MetricGrid
        metrics={[
          { label: t("tools.metrics.found"), value: records.length },
          { label: t("tools.metrics.jobs"), value: nearby.data?.jobs.length || 0 },
          { label: t("tools.metrics.rentals"), value: bookings.data?.length || 0 },
          { label: t("tools.metrics.helpers"), value: nearby.data?.helpers.length || 0 }
        ]}
      />

      <Card>
        <AppText variant="headline">{t("tools.search")}</AppText>
        <FormInput placeholder={t("tools.name")} value={filters.name} onChangeText={(name) => setFilters((prev) => ({ ...prev, name }))} />
        <View style={styles.split}>
          <FormInput style={styles.splitInput} placeholder={t("tools.city")} value={filters.city} onChangeText={(city) => setFilters((prev) => ({ ...prev, city }))} />
          <FormInput style={styles.splitInput} placeholder={t("tools.category")} value={filters.category} onChangeText={(category) => setFilters((prev) => ({ ...prev, category }))} />
        </View>
      </Card>

      {records.map((tool) => (
        <Card key={String(tool.id)}>
          {tool.image_url ? <Image source={{ uri: tool.image_url }} style={styles.image} /> : null}
          <AppText variant="headline">{tool.name}</AppText>
          <AppText variant="muted">{tool.description || tool.category || t("tools.caption")}</AppText>
          <AppText variant="caption">
            {[
              formatCurrency(Number(tool.daily_rate || 0)),
              tool.requires_deposit ? `${t("tools.category")}: ${formatCurrency(Number(tool.deposit_amount || 0))}` : null,
              tool.location_city,
              tool.owner_name
            ].filter(Boolean).join(" - ")}
          </AppText>
          <Button onPress={() => setSelectedTool(tool)}>{t("tools.rentThis")}</Button>
          {tool.owner_id && (
            <Button variant="secondary" onPress={() => api.createConversation({ helperId: tool.owner_id! }).then(() => Alert.alert(t("tools.ownerMessageStarted"), t("tools.ownerMessageBody")))}>
              {t("tools.messageOwner")}
            </Button>
          )}
        </Card>
      ))}

      {selectedTool && (
        <Card>
          <AppText variant="headline">{t("tools.reserve", { name: selectedTool.name })}</AppText>
          <FormInput placeholder={t("tools.startDate")} value={dates.startDate} onChangeText={(startDate) => setDates((prev) => ({ ...prev, startDate }))} />
          <FormInput placeholder={t("tools.endDate")} value={dates.endDate} onChangeText={(endDate) => setDates((prev) => ({ ...prev, endDate }))} />
          <AppText variant="caption">{t("tools.agreement")}</AppText>
          <Button disabled={!dates.startDate || !dates.endDate || bookTool.isPending} onPress={() => bookTool.mutate()}>
            {t("tools.requestRental")}
          </Button>
        </Card>
      )}

      <Card>
        <AppText variant="headline">{t("tools.myBookings")}</AppText>
        {(bookings.data || []).slice(0, 6).map((booking) => (
          <View key={String(booking.id)} style={styles.row}>
            <AppText>{booking.name || `Tool booking ${booking.id}`}</AppText>
            <AppText variant="caption">{[booking.start_date, booking.end_date, booking.status, formatCurrency(Number(booking.total_price || 0))].filter(Boolean).join(" - ")}</AppText>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  split: {
    flexDirection: "row",
    gap: spacing.sm
  },
  splitInput: {
    flex: 1
  },
  image: {
    width: "100%",
    height: 150,
    borderRadius: 8,
    backgroundColor: colors.panelSoft
  },
  row: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border
  }
});
