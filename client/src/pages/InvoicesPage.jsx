import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { useAuth } from '../hooks/useAuth';
import invoicesApi from '../api/invoices';
import { Download, Mail, Eye } from 'lucide-react';

export default function InvoicesPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [resendingEmail, setResendingEmail] = useState(null);

  useEffect(() => {
    loadInvoices();
  }, []);

  const loadInvoices = async () => {
    try {
      setLoading(true);
      const response = await invoicesApi.listInvoices();
      setInvoices(response.data.invoices || []);
    } catch (err) {
      toast.error(t('invoices.loadError') || 'Failed to load invoices');
      console.error('Failed to load invoices', err);
    } finally {
      setLoading(false);
    }
  };

  const handleResendEmail = async (invoiceId) => {
    try {
      setResendingEmail(invoiceId);
      await invoicesApi.resendInvoiceEmail(invoiceId);
      toast.success(t('invoices.emailResent') || 'Invoice email sent successfully');
    } catch (err) {
      toast.error(t('invoices.emailError') || 'Failed to send invoice email');
      console.error('Failed to resend email', err);
    } finally {
      setResendingEmail(null);
    }
  };

  const pageStyle = {
    padding: '2rem',
    background: 'var(--color-bg)',
    minHeight: '100vh',
  };

  const titleStyle = {
    fontSize: '2rem',
    fontWeight: 'bold',
    marginBottom: '2rem',
    color: 'var(--color-text)',
  };

  const tableContainerStyle = {
    background: 'var(--color-surface)',
    borderRadius: '8px',
    overflow: 'hidden',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
  };

  const tableHeaderStyle = {
    background: 'var(--color-bg)',
    padding: '1rem',
    borderBottom: '1px solid var(--color-border)',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
    gap: '1rem',
    fontWeight: '600',
    color: 'var(--color-text)',
  };

  const tableRowStyle = {
    padding: '1rem',
    borderBottom: '1px solid var(--color-border)',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
    gap: '1rem',
    alignItems: 'center',
    color: 'var(--color-text)',
  };

  const statusBadgeStyle = (status) => {
    const colors = {
      draft: '#f59e0b',
      issued: '#3b82f6',
      paid: '#10b981',
      overdue: '#ef4444',
      cancelled: '#6b7280',
    };

    return {
      display: 'inline-block',
      padding: '0.35rem 0.75rem',
      borderRadius: '6px',
      background: colors[status] || colors.draft,
      color: 'white',
      fontWeight: '600',
      fontSize: '0.85rem',
    };
  };

  const buttonStyle = {
    padding: '0.5rem 0.75rem',
    background: 'var(--color-primary)',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '0.85rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  };

  const emptyStateStyle = {
    textAlign: 'center',
    padding: '3rem 1rem',
    color: 'var(--color-text-muted)',
  };

  if (loading) {
    return <div style={pageStyle}>{t('common.loading') || 'Loading...'}</div>;
  }

  return (
    <div style={pageStyle}>
      <h1 style={titleStyle}>{t('invoices.title') || 'My Invoices'}</h1>

      {invoices.length > 0 ? (
        <div style={tableContainerStyle}>
          <div style={tableHeaderStyle}>
            <div>{t('invoices.number') || 'Invoice #'}</div>
            <div>{t('invoices.date') || 'Date'}</div>
            <div>{t('invoices.amount') || 'Amount'}</div>
            <div>{t('invoices.status') || 'Status'}</div>
            <div>{t('invoices.dueDate') || 'Due Date'}</div>
            <div>{t('invoices.actions') || 'Actions'}</div>
          </div>

          {invoices.map((invoice) => (
            <div key={invoice.id} style={tableRowStyle}>
              <div style={{ fontWeight: '600' }}>{invoice.invoice_number}</div>
              <div>{new Date(invoice.issued_at).toLocaleDateString()}</div>
              <div>${(invoice.amount_cents / 100).toFixed(2)}</div>
              <div style={statusBadgeStyle(invoice.status)}>
                {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
              </div>
              <div>{new Date(invoice.due_at).toLocaleDateString()}</div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  style={buttonStyle}
                  onClick={() => setSelectedInvoice(invoice)}
                  title={t('invoices.view') || 'View'}
                >
                  <Eye size={16} />
                </button>
                <button
                  style={buttonStyle}
                  onClick={() => handleResendEmail(invoice.id)}
                  disabled={resendingEmail === invoice.id}
                  title={t('invoices.resendEmail') || 'Resend Email'}
                >
                  <Mail size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={emptyStateStyle}>
          <p>{t('invoices.noInvoices') || 'No invoices yet'}</p>
          <p style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}>
            {t('invoices.emptyMessage') || 'Your invoices will appear here after purchasing consulting sessions.'}
          </p>
        </div>
      )}

      {/* Invoice Detail Modal */}
      {selectedInvoice && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setSelectedInvoice(null)}
        >
          <div
            style={{
              background: 'var(--color-surface)',
              borderRadius: '12px',
              padding: '2rem',
              maxWidth: '600px',
              width: '90%',
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 10px 40px rgba(0, 0, 0, 0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ fontSize: '1.5rem', fontWeight: '700', color: 'var(--color-text)' }}>
                {selectedInvoice.invoice_number}
              </h2>
              <button
                onClick={() => setSelectedInvoice(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '1.5rem',
                  color: 'var(--color-text-muted)',
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'grid', gap: '1rem', marginBottom: '1.5rem' }}>
              <div>
                <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                  {t('invoices.status') || 'Status'}
                </div>
                <div style={statusBadgeStyle(selectedInvoice.status)}>
                  {selectedInvoice.status.charAt(0).toUpperCase() + selectedInvoice.status.slice(1)}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                  {t('invoices.amount') || 'Amount'}
                </div>
                <div style={{ fontSize: '1.25rem', fontWeight: '700', color: 'var(--color-primary)' }}>
                  ${(selectedInvoice.amount_cents / 100).toFixed(2)}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                    {t('invoices.issuedDate') || 'Issued'}
                  </div>
                  <div>{new Date(selectedInvoice.issued_at).toLocaleDateString()}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                    {t('invoices.dueDate') || 'Due Date'}
                  </div>
                  <div>{new Date(selectedInvoice.due_at).toLocaleDateString()}</div>
                </div>
              </div>

              {selectedInvoice.paid_at && (
                <div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                    {t('invoices.paidDate') || 'Paid'}
                  </div>
                  <div>{new Date(selectedInvoice.paid_at).toLocaleDateString()}</div>
                </div>
              )}

              <div>
                <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                  {t('invoices.customerName') || 'Customer'}
                </div>
                <div>{selectedInvoice.customer_name}</div>
              </div>

              <div>
                <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                  {t('invoices.consultant') || 'Consultant'}
                </div>
                <div>{selectedInvoice.consultant_name}</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--color-border)' }}>
              <button
                onClick={() => handleResendEmail(selectedInvoice.id)}
                disabled={resendingEmail === selectedInvoice.id}
                style={{
                  ...buttonStyle,
                  flex: 1,
                }}
              >
                <Mail size={16} />
                {resendingEmail === selectedInvoice.id ? t('common.sending') || 'Sending...' : t('invoices.resendEmail') || 'Resend Email'}
              </button>
              <button
                onClick={() => setSelectedInvoice(null)}
                style={{
                  padding: '0.5rem 1.5rem',
                  background: 'var(--color-bg)',
                  color: 'var(--color-text)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: '600',
                }}
              >
                {t('common.close') || 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
