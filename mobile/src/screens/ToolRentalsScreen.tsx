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
import { colors, spacing } from "../theme";

function money(value?: string | number | null) {
  const num = Number(value || 0);
  return `$${num.toFixed(2)}`;
}

export function ToolRentalsScreen() {
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
      if (!selectedTool) throw new Error("Choose a tool first.");
      return api.createToolBooking({
        toolId: selectedTool.id,
        startDate: dates.startDate,
        endDate: dates.endDate,
        renterAgreementAccepted: true
      });
    },
    onSuccess: async () => {
      Alert.alert("Tool requested", "The rental request is recorded. If a deposit is required, use the generated rental invoice or owner payment method.");
      setSelectedTool(null);
      setDates({ startDate: "", endDate: "" });
      await queryClient.invalidateQueries({ queryKey: ["tool-bookings"] });
    },
    onError: (error) => Alert.alert("Could not book tool", error instanceof Error ? error.message : "Please try again.")
  });

  const records = tools.data?.tools || [];

  return (
    <Screen>
      <View>
        <AppText variant="caption">TOOL RENTALS</AppText>
        <AppText variant="title">Browse, reserve, and coordinate tools nearby.</AppText>
      </View>

      <MetricGrid
        metrics={[
          { label: "Tools found", value: records.length },
          { label: "Nearby jobs", value: nearby.data?.jobs.length || 0 },
          { label: "My rentals", value: bookings.data?.length || 0 },
          { label: "Nearby helpers", value: nearby.data?.helpers.length || 0 }
        ]}
      />

      <Card>
        <AppText variant="headline">Search tools</AppText>
        <FormInput placeholder="Tool name" value={filters.name} onChangeText={(name) => setFilters((prev) => ({ ...prev, name }))} />
        <View style={styles.split}>
          <FormInput style={styles.splitInput} placeholder="City" value={filters.city} onChangeText={(city) => setFilters((prev) => ({ ...prev, city }))} />
          <FormInput style={styles.splitInput} placeholder="Category" value={filters.category} onChangeText={(category) => setFilters((prev) => ({ ...prev, category }))} />
        </View>
      </Card>

      {records.map((tool) => (
        <Card key={String(tool.id)}>
          {tool.image_url ? <Image source={{ uri: tool.image_url }} style={styles.image} /> : null}
          <AppText variant="headline">{tool.name}</AppText>
          <AppText variant="muted">{tool.description || tool.category || "Tool rental"}</AppText>
          <AppText variant="caption">
            {[money(tool.daily_rate), tool.requires_deposit ? `Deposit ${money(tool.deposit_amount)}` : null, tool.location_city, tool.owner_name].filter(Boolean).join(" - ")}
          </AppText>
          <Button onPress={() => setSelectedTool(tool)}>Rent this tool</Button>
          {tool.owner_id && (
            <Button variant="secondary" onPress={() => api.createConversation({ helperId: tool.owner_id! }).then(() => Alert.alert("Message started", "Open Messages to continue the rental conversation."))}>
              Message owner
            </Button>
          )}
        </Card>
      ))}

      {selectedTool && (
        <Card>
          <AppText variant="headline">Reserve {selectedTool.name}</AppText>
          <FormInput placeholder="Start date YYYY-MM-DD" value={dates.startDate} onChangeText={(startDate) => setDates((prev) => ({ ...prev, startDate }))} />
          <FormInput placeholder="End date YYYY-MM-DD" value={dates.endDate} onChangeText={(endDate) => setDates((prev) => ({ ...prev, endDate }))} />
          <AppText variant="caption">By booking, you accept the peer rental agreement and owner rules for this listing.</AppText>
          <Button disabled={!dates.startDate || !dates.endDate || bookTool.isPending} onPress={() => bookTool.mutate()}>
            Request rental
          </Button>
        </Card>
      )}

      <Card>
        <AppText variant="headline">My tool bookings</AppText>
        {(bookings.data || []).slice(0, 6).map((booking) => (
          <View key={String(booking.id)} style={styles.row}>
            <AppText>{booking.name || `Tool booking ${booking.id}`}</AppText>
            <AppText variant="caption">{[booking.start_date, booking.end_date, booking.status, money(booking.total_price)].filter(Boolean).join(" - ")}</AppText>
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
