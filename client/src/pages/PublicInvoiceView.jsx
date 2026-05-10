import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import '../styles/PublicInvoiceView.css';

function PublicInvoiceView() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [invoice, setInvoice] = useState(null);
  const [business, setBusiness] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadInvoice();
  }, [token]);

  const loadInvoice = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/businesses/invoices/public/${token}`);
      const { invoice, business } = response.data;
      setInvoice(invoice);
      setBusiness(business);
      setError(null);
    } catch (err) {
      setError('Invoice not found or has expired');
      console.error('Error loading invoice:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="piv-container">
        <div className="piv-loading">
          <p>{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="piv-container">
        <div className="piv-error">
          <h1>{t('common.notFound')}</h1>
          <p>{error || 'Invoice not found'}</p>
          <button onClick={() => navigate('/')} className="piv-btn-home">
            {t('common.backHome')}
          </button>
        </div>
      </div>
    );
  }

  const lineItems = Array.isArray(invoice.line_items)
    ? invoice.line_items
    : JSON.parse(invoice.line_items || '[]');

  const subtotal = parseFloat(invoice.subtotal || 0);
  const taxAmount = parseFloat(invoice.tax_amount || 0);
  const total = parseFloat(invoice.total || 0);

  const formattedDate = new Date(invoice.issue_date).toLocaleDateString();
  const formattedDueDate = invoice.due_date
    ? new Date(invoice.due_date).toLocaleDateString()
    : null;

  return (
    <div className="piv-container">
      <div className="piv-header">
        {business?.logo_url && (
          <img src={business.logo_url} alt={business.business_name} className="piv-logo" />
        )}
        <div className="piv-header-text">
          <h1>{business?.business_name}</h1>
          {business?.phone && <p>{business.phone}</p>}
          {business?.website && (
            <p>
              <a href={business.website} target="_blank" rel="noopener noreferrer">
                {business.website}
              </a>
            </p>
          )}
        </div>
      </div>

      <div className="piv-content">
        {/* Invoice details row */}
        <div className="piv-invoice-details">
          <div className="piv-detail-group">
            <label>Invoice Number</label>
            <p>{invoice.invoice_number}</p>
          </div>
          <div className="piv-detail-group">
            <label>Date</label>
            <p>{formattedDate}</p>
          </div>
          {formattedDueDate && (
            <div className="piv-detail-group">
              <label>Due Date</label>
              <p>{formattedDueDate}</p>
            </div>
          )}
          <div className="piv-detail-group">
            <label>Status</label>
            <p className={`piv-status piv-status-${invoice.status}`}>
              {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
            </p>
          </div>
        </div>

        {/* Bill to section */}
        <div className="piv-bill-to">
          <h3>Bill To:</h3>
          <p className="piv-client-name">{invoice.client_name}</p>
          {invoice.client_company && <p>{invoice.client_company}</p>}
          {invoice.client_email && <p>{invoice.client_email}</p>}
        </div>

        {/* Line items table */}
        <table className="piv-line-items">
          <thead>
            <tr>
              <th>Description</th>
              <th>Qty</th>
              <th>Unit Price</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {lineItems.map((item, idx) => (
              <tr key={idx}>
                <td>{item.description}</td>
                <td className="piv-text-center">{item.quantity || 1}</td>
                <td className="piv-text-right">${(item.unit_price || 0).toFixed(2)}</td>
                <td className="piv-text-right">
                  ${((item.quantity || 1) * (item.unit_price || 0)).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals section */}
        <div className="piv-totals">
          <div className="piv-total-row">
            <span>Subtotal:</span>
            <span>${subtotal.toFixed(2)}</span>
          </div>
          {taxAmount > 0 && (
            <div className="piv-total-row">
              <span>Tax ({invoice.invoice_tax_rate || 0}%):</span>
              <span>${taxAmount.toFixed(2)}</span>
            </div>
          )}
          <div className="piv-total-row piv-total-amount">
            <span>Total Due:</span>
            <span>${total.toFixed(2)}</span>
          </div>
          {invoice.amount_paid > 0 && (
            <div className="piv-total-row">
              <span>Amount Paid:</span>
              <span>${parseFloat(invoice.amount_paid).toFixed(2)}</span>
            </div>
          )}
        </div>

        {/* Notes section */}
        {invoice.notes && (
          <div className="piv-notes">
            <h3>Notes:</h3>
            <p>{invoice.notes}</p>
          </div>
        )}
      </div>

      {/* CTA section */}
      <div className="piv-cta-section">
        <h3>Next Steps</h3>
        {invoice.status === 'paid' ? (
          <div className="piv-paid-message">
            <p>Thank you for your payment!</p>
          </div>
        ) : (
          <div className="piv-cta-buttons">
            <a href="/login" className="piv-btn piv-btn-primary">
              Login to Pay
            </a>
            <p className="piv-contact-text">
              Questions? Contact {business?.business_name}
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="piv-footer">
        <p>&copy; {new Date().getFullYear()} {business?.business_name}. All rights reserved.</p>
      </div>
    </div>
  );
}

export default PublicInvoiceView;
