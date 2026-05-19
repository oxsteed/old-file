import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Invoice } from "../api/types";
import { Card } from "../components/Card";
import { MetricGrid } from "../components/MetricGrid";
import { Screen } from "../components/Screen";
import { AppText } from "../components/Text";
import { colors, spacing } from "../theme";

function cents(invoice: Invoice) {
  if (invoice.amount_cents !== undefined) return Number(invoice.amount_cents || 0);
  if (invoice.total !== undefined) return Math.round(Number(invoice.total || 0) * 100);
  return 0;
}

function money(value: number) {
  return `$${(value / 100).toFixed(2)}`;
}

export function PaymentsScreen() {
  const invoices = useQuery({
    queryKey: ["invoices"],
    queryFn: api.listInvoices
  });

  const records = invoices.data || [];
  const total = records.reduce((sum, invoice) => sum + cents(invoice), 0);
  const paid = records.filter((invoice) => invoice.status === "paid").reduce((sum, invoice) => sum + cents(invoice), 0);
  const open = records.filter((invoice) => ["draft", "sent", "issued", "overdue", "partial"].includes(invoice.status || "")).length;

  return (
    <Screen>
      <View>
        <AppText variant="caption">PAYMENTS</AppText>
        <AppText variant="title">Track invoices and payment status.</AppText>
        <AppText variant="muted">
          Full escrow and card-management screens come later; Phase 2 surfaces the existing invoice/payment records natively.
        </AppText>
      </View>

      <MetricGrid
        metrics={[
          { label: "Invoice value", value: money(total) },
          { label: "Paid", value: money(paid) },
          { label: "Open records", value: open },
          { label: "Total records", value: records.length }
        ]}
      />

      <Card>
        <AppText variant="headline">Saved payment method</AppText>
        <AppText variant="muted">
          Payment method setup will connect to the Stripe mobile SDK in the scheduling/payment phase. For now, invoices show whether payment is pending, partial, or complete.
        </AppText>
      </Card>

      {invoices.isLoading ? <ActivityIndicator color={colors.orange} /> : null}
      {records.map((invoice) => (
        <Card key={String(invoice.id)}>
          <AppText variant="headline">{invoice.invoice_number || `Invoice ${invoice.id}`}</AppText>
          <AppText variant="muted">{invoice.business_name || invoice.client_name || "OxSteed invoice"}</AppText>
          <AppText variant="caption">
            {[money(cents(invoice)), invoice.status || "draft", invoice.due_at ? `due ${invoice.due_at}` : null].filter(Boolean).join(" • ")}
          </AppText>
        </Card>
      ))}
      {records.length === 0 && !invoices.isLoading && (
        <Card>
          <AppText variant="headline">No invoices yet</AppText>
          <AppText variant="muted">Invoices and payment records will appear here after bookings, products, rentals, or services create them.</AppText>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  unused: {
    gap: spacing.sm
  }
});
