import { useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { initStripe, useStripe } from "@stripe/stripe-react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, OxSteedApiError } from "../api/client";
import type { Invoice } from "../api/types";
import { Button } from "../components/Button";
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
  const stripe = useStripe();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<string | null>(null);

  const invoices = useQuery({
    queryKey: ["invoices"],
    queryFn: api.listInvoices
  });

  const payInvoice = useMutation({
    mutationFn: async (invoice: Invoice) => {
      setStatus(`Preparing secure payment for ${invoice.invoice_number || `invoice ${invoice.id}`}...`);
      const intent = await api.createInvoicePaymentIntent(invoice.id);
      await initStripe({
        publishableKey: intent.publishableKey,
        merchantIdentifier: "merchant.com.oxsteed.app"
      });
      const initResult = await stripe.initPaymentSheet({
        merchantDisplayName: "OxSteed",
        paymentIntentClientSecret: intent.clientSecret,
        defaultBillingDetails: {
          email: invoice.client_email
        }
      });
      if (initResult.error) throw new Error(initResult.error.message);

      const sheetResult = await stripe.presentPaymentSheet();
      if (sheetResult.error) throw new Error(sheetResult.error.message);

      await api.confirmInvoicePayment(invoice.id, intent.paymentIntentId);
      return invoice;
    },
    onSuccess: async (invoice) => {
      setStatus(`${invoice.invoice_number || "Invoice"} paid successfully.`);
      await queryClient.invalidateQueries({ queryKey: ["invoices"] });
      await queryClient.invalidateQueries({ queryKey: ["mobile-feed"] });
    },
    onError: (error) => {
      setStatus(error instanceof OxSteedApiError || error instanceof Error ? error.message : "Payment failed.");
    }
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
          Pay invoices securely in-app through Stripe, then keep paid, partial, and open records visible in one place.
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
        <AppText variant="headline">Secure card payment</AppText>
        <AppText variant="muted">
          OxSteed opens Stripe PaymentSheet for invoices. Job escrow and product carts use the same payment infrastructure and can share this native payment surface as those screens expand.
        </AppText>
        {status && <AppText variant="caption">{status}</AppText>}
      </Card>

      {invoices.isLoading ? <ActivityIndicator color={colors.orange} /> : null}
      {records.map((invoice) => (
        <Card key={String(invoice.id)}>
          <AppText variant="headline">{invoice.invoice_number || `Invoice ${invoice.id}`}</AppText>
          <AppText variant="muted">{invoice.business_name || invoice.client_name || "OxSteed invoice"}</AppText>
          <AppText variant="caption">
            {[money(cents(invoice)), invoice.status || "draft", invoice.due_at ? `due ${invoice.due_at}` : null].filter(Boolean).join(" • ")}
          </AppText>
          {invoice.status !== "paid" && (
            <Button disabled={payInvoice.isPending} onPress={() => payInvoice.mutate(invoice)}>
              {payInvoice.isPending ? "Processing..." : `Pay ${money(cents(invoice))}`}
            </Button>
          )}
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
