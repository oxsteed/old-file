import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { api } from "../api/client";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { MetricGrid } from "../components/MetricGrid";
import { Screen } from "../components/Screen";
import { AppText } from "../components/Text";
import { colors, spacing } from "../theme";

function money(value?: string | number | null) {
  return `$${Number(value || 0).toFixed(2)}`;
}

export function BusinessHubLiteScreen() {
  const queryClient = useQueryClient();
  const [businessId, setBusinessId] = useState<string | number | null>(null);
  const feed = useQuery({ queryKey: ["mobile-feed"], queryFn: api.mobileFeed });
  const businesses = feed.data?.businesses || [];
  const activeBusinessId = businessId || businesses[0]?.id;

  const summary = useQuery({
    queryKey: ["business-mobile-summary", activeBusinessId],
    enabled: Boolean(activeBusinessId),
    queryFn: () => api.businessMobileSummary(activeBusinessId!)
  });

  const toggleProduct = useMutation({
    mutationFn: (product: { id: string | number; is_active?: boolean }) =>
      product.is_active
        ? api.unpublishBusinessProduct(activeBusinessId!, product.id)
        : api.publishBusinessProduct(activeBusinessId!, product.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["business-mobile-summary", activeBusinessId] });
    },
    onError: (error) => Alert.alert("Product update failed", error instanceof Error ? error.message : "Please try again.")
  });

  return (
    <Screen>
      <View>
        <AppText variant="caption">BUSINESS HUB LITE</AppText>
        <AppText variant="title">A mobile command center for daily business work.</AppText>
      </View>

      <Card>
        <AppText variant="headline">Business</AppText>
        {businesses.map((business) => (
          <Button key={String(business.id)} variant={String(activeBusinessId) === String(business.id) ? "primary" : "secondary"} onPress={() => setBusinessId(business.id)}>
            {business.business_name}
          </Button>
        ))}
        {!businesses.length && <AppText variant="muted">No owned businesses were found for this account.</AppText>}
      </Card>

      {summary.data && (
        <>
          <MetricGrid
            metrics={[
              { label: "Paid revenue", value: money(summary.data.overview.paidRevenue) },
              { label: "Outstanding", value: money(summary.data.overview.outstanding) },
              { label: "Unread messages", value: summary.data.overview.unreadMessages },
              { label: "Health", value: `${summary.data.overview.profileCompleteness}%` }
            ]}
          />

          <Card>
            <AppText variant="headline">Calendar & appointments</AppText>
            {summary.data.appointments.map((appointment) => (
              <View key={appointment.id} style={styles.row}>
                <AppText>{appointment.title || appointment.job_title || "Appointment"}</AppText>
                <AppText variant="caption">{[appointment.scheduled_start_time, appointment.status].filter(Boolean).join(" - ")}</AppText>
              </View>
            ))}
            {!summary.data.appointments.length && <AppText variant="muted">No upcoming appointments.</AppText>}
          </Card>

          <Card>
            <AppText variant="headline">Invoices</AppText>
            {summary.data.invoices.map((invoice) => (
              <View key={String(invoice.id)} style={styles.row}>
                <AppText>{invoice.invoice_number || `Invoice ${invoice.id}`}</AppText>
                <AppText variant="caption">{[money(invoice.total), invoice.status, invoice.client_email].filter(Boolean).join(" - ")}</AppText>
              </View>
            ))}
          </Card>

          <Card>
            <AppText variant="headline">Business messages</AppText>
            {summary.data.messages.map((message) => (
              <View key={String(message.id)} style={styles.row}>
                <AppText>{message.last_message || "Business conversation"}</AppText>
                <AppText variant="caption">{[message.status, Number(message.unread_count || 0) ? `${message.unread_count} unread` : null].filter(Boolean).join(" - ")}</AppText>
              </View>
            ))}
          </Card>

          <Card>
            <AppText variant="headline">Products</AppText>
            {summary.data.products.map((product) => (
              <View key={String(product.id)} style={styles.row}>
                <AppText>{product.name}</AppText>
                <AppText variant="caption">{[product.category, money(Number(product.price_cents || 0) / 100), `${product.total_stock || 0} stock`, product.is_active ? "Published" : "Unpublished"].filter(Boolean).join(" - ")}</AppText>
                <Button variant="secondary" disabled={toggleProduct.isPending} onPress={() => toggleProduct.mutate(product)}>
                  {product.is_active ? "Unpublish" : "Publish"}
                </Button>
              </View>
            ))}
          </Card>

          <Card>
            <AppText variant="headline">Health checklist</AppText>
            {summary.data.health.map((item) => (
              <View key={item.label} style={styles.row}>
                <AppText>{item.label}</AppText>
                <AppText variant="caption">{item.value} - {item.status}</AppText>
              </View>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border
  }
});
