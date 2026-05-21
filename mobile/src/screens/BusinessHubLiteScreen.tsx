import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { api } from "../api/client";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { MetricGrid } from "../components/MetricGrid";
import { Screen } from "../components/Screen";
import { AppText } from "../components/Text";
import { useI18n } from "../i18n";
import { colors, spacing } from "../theme";

export function BusinessHubLiteScreen() {
  const { t, formatCurrency } = useI18n();
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
    onError: (error) => Alert.alert(t("business.productUpdateFailed"), error instanceof Error ? error.message : t("common.retry"))
  });

  return (
    <Screen>
      <View>
        <AppText variant="caption">{t("business.caption")}</AppText>
        <AppText variant="title">{t("business.title")}</AppText>
      </View>

      <Card>
        <AppText variant="headline">{t("business.choose")}</AppText>
        {businesses.map((business) => (
          <Button key={String(business.id)} variant={String(activeBusinessId) === String(business.id) ? "primary" : "secondary"} onPress={() => setBusinessId(business.id)}>
            {business.business_name}
          </Button>
        ))}
        {!businesses.length && <AppText variant="muted">{t("business.none")}</AppText>}
      </Card>

      {summary.data && (
        <>
          <MetricGrid
            metrics={[
              { label: t("business.metrics.paidRevenue"), value: formatCurrency(Number(summary.data.overview.paidRevenue || 0)) },
              { label: t("business.metrics.outstanding"), value: formatCurrency(Number(summary.data.overview.outstanding || 0)) },
              { label: t("business.metrics.unread"), value: summary.data.overview.unreadMessages },
              { label: t("business.metrics.health"), value: `${summary.data.overview.profileCompleteness}%` }
            ]}
          />

          <Card>
            <AppText variant="headline">{t("business.appointments")}</AppText>
            {summary.data.appointments.map((appointment) => (
              <View key={appointment.id} style={styles.row}>
                <AppText>{appointment.title || appointment.job_title || t("business.appointment")}</AppText>
                <AppText variant="caption">{[appointment.scheduled_start_time, appointment.status].filter(Boolean).join(" - ")}</AppText>
              </View>
            ))}
            {!summary.data.appointments.length && <AppText variant="muted">{t("business.appointments.empty")}</AppText>}
          </Card>

          <Card>
            <AppText variant="headline">{t("business.invoices")}</AppText>
            {summary.data.invoices.map((invoice) => (
              <View key={String(invoice.id)} style={styles.row}>
                <AppText>{invoice.invoice_number || `Invoice ${invoice.id}`}</AppText>
                <AppText variant="caption">{[formatCurrency(Number(invoice.total || 0)), invoice.status, invoice.client_email].filter(Boolean).join(" - ")}</AppText>
              </View>
            ))}
          </Card>

          <Card>
            <AppText variant="headline">{t("business.messages")}</AppText>
            {summary.data.messages.map((message) => (
              <View key={String(message.id)} style={styles.row}>
                <AppText>{message.last_message || t("business.conversation")}</AppText>
                <AppText variant="caption">{[message.status, Number(message.unread_count || 0) ? t("business.unreadCount", { count: Number(message.unread_count || 0) }) : null].filter(Boolean).join(" - ")}</AppText>
              </View>
            ))}
          </Card>

          <Card>
            <AppText variant="headline">{t("business.products")}</AppText>
            {summary.data.products.map((product) => (
              <View key={String(product.id)} style={styles.row}>
                <AppText>{product.name}</AppText>
                <AppText variant="caption">{[product.category, formatCurrency(Number(product.price_cents || 0) / 100), `${product.total_stock || 0} stock`, product.is_active ? t("business.publish") : t("business.unpublish")].filter(Boolean).join(" - ")}</AppText>
                <Button variant="secondary" disabled={toggleProduct.isPending} onPress={() => toggleProduct.mutate(product)}>
                  {product.is_active ? t("business.unpublish") : t("business.publish")}
                </Button>
              </View>
            ))}
          </Card>

          <Card>
            <AppText variant="headline">{t("business.health")}</AppText>
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
