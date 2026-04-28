import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader, CheckCircle, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import PageMeta from '../components/PageMeta';
import { shareApi } from '../api/marketplaceApi';
import '../styles/SharedCartPage.css';

export default function SharedCartPage() {
  const { t } = useTranslation();
  const { shareToken } = useParams();
  const [cart, setCart] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isApproving, setIsApproving] = useState(false);
  const [showApprovalForm, setShowApprovalForm] = useState(false);
  const [approvalNotes, setApprovalNotes] = useState('');
  const [approved, setApproved] = useState(false);

  useEffect(() => {
    const loadSharedCart = async () => {
      try {
        const response = await shareApi.viewSharedCart(shareToken);
        setCart(response.data);
        setItems(response.data.items || []);
        setError(null);
      } catch (err) {
        const message =
          err.response?.data?.error || t('marketplace.failedToLoadCart');
        setError(message);
        toast.error(message);
      } finally {
        setLoading(false);
      }
    };

    if (shareToken) {
      loadSharedCart();
    }
  }, [shareToken, t]);

  const handleApproveCart = async () => {
    setIsApproving(true);
    try {
      await shareApi.approveCart(shareToken, approvalNotes);
      setApproved(true);
      toast.success(t('marketplace.cartApproved'));
      setShowApprovalForm(false);
    } catch (err) {
      const message =
        err.response?.data?.error || t('common.errorUpdating');
      toast.error(message);
    } finally {
      setIsApproving(false);
    }
  };

  const calculateTotals = () => {
    if (!items) return { subtotal: 0, tax: 0, total: 0 };
    const subtotal = items.reduce((sum, item) => {
      return sum + (item.unit_price_cents || 0) * item.quantity;
    }, 0);
    const tax = Math.round(subtotal * 0.1);
    const total = subtotal + tax;
    return {
      subtotal: (subtotal / 100).toFixed(2),
      tax: (tax / 100).toFixed(2),
      total: (total / 100).toFixed(2),
    };
  };

  const totals = calculateTotals();

  if (loading) {
    return (
      <div className="scp-page-loading">
        <Loader className="scp-page-spinner" />
        <p>{t('common.loading')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="scp-page-error">
        <XCircle className="scp-page-error-icon" />
        <h1>{t('marketplace.cartNotFound')}</h1>
        <p>{error}</p>
      </div>
    );
  }

  if (approved) {
    return (
      <div className="scp-page-success">
        <CheckCircle className="scp-page-success-icon" />
        <h1>{t('marketplace.thanksForApproving')}</h1>
        <p>{t('marketplace.yourApprovalHasBeenRecorded')}</p>
      </div>
    );
  }

  return (
    <>
      <PageMeta
        title={cart?.cart?.name || t('marketplace.sharedCart')}
        description={t('marketplace.reviewingCartDescription')}
      />

      <div className="scp-page-container">
        {/* Header */}
        <div className="scp-page-header">
          <h1>{cart?.cart?.name}</h1>
          {cart?.cart?.description && (
            <p className="scp-page-description">{cart.cart.description}</p>
          )}
        </div>

        <div className="scp-page-content">
          {/* Items Section */}
          <div className="scp-page-items-section">
            <h2>{t('marketplace.itemsInThisCart')} ({items.length})</h2>

            {items.length === 0 ? (
              <div className="scp-page-empty-items">
                <p>{t('marketplace.noItems')}</p>
              </div>
            ) : (
              <div className="scp-page-items-list">
                {items.map((item) => (
                  <div key={item.id} className="scp-page-item">
                    {item.product_image_url && (
                      <img
                        src={item.product_image_url}
                        alt={item.product_name}
                        className="scp-page-item-image"
                        loading="lazy"
                      />
                    )}
                    <div className="scp-page-item-info">
                      <h3>{item.product_name}</h3>
                      {item.category && (
                        <p className="scp-page-item-category">{item.category}</p>
                      )}
                      {item.notes && (
                        <p className="scp-page-item-notes">{item.notes}</p>
                      )}
                    </div>

                    <div className="scp-page-item-details">
                      <div className="scp-page-item-qty">
                        <span className="scp-page-item-qty-label">
                          {t('marketplace.quantity')}:
                        </span>
                        <span className="scp-page-item-qty-value">
                          {item.quantity}
                        </span>
                      </div>
                      <div className="scp-page-item-unit-price">
                        <span className="scp-page-price-label">
                          {t('marketplace.unitPrice')}:
                        </span>
                        <span className="scp-page-price-value">
                          ${((item.unit_price_cents || 0) / 100).toFixed(2)}
                        </span>
                      </div>
                      <div className="scp-page-item-total">
                        <span className="scp-page-total-label">
                          {t('marketplace.subtotal')}:
                        </span>
                        <span className="scp-page-total-value">
                          ${(
                            ((item.unit_price_cents || 0) * item.quantity) /
                            100
                          ).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Summary Section */}
          <div className="scp-page-summary-section">
            <div className="scp-page-summary">
              <h2>{t('marketplace.orderSummary')}</h2>

              <div className="scp-page-summary-row">
                <span>{t('marketplace.subtotal')}</span>
                <span>${totals.subtotal}</span>
              </div>

              <div className="scp-page-summary-row">
                <span>{t('marketplace.tax')}</span>
                <span>${totals.tax}</span>
              </div>

              <div className="scp-page-summary-row scp-page-summary-total">
                <span>{t('marketplace.total')}</span>
                <span>${totals.total}</span>
              </div>

              <div className="scp-page-info-box">
                <p>
                  {t('marketplace.youCanReviewAndApproveThisCart')}
                </p>
              </div>

              {!showApprovalForm ? (
                <button
                  onClick={() => setShowApprovalForm(true)}
                  className="scp-page-approve-btn"
                >
                  {t('marketplace.approveAndProceed')}
                </button>
              ) : (
                <div className="scp-page-approval-form">
                  <label>{t('marketplace.optionalNotes')}</label>
                  <textarea
                    value={approvalNotes}
                    onChange={(e) => setApprovalNotes(e.target.value)}
                    placeholder={t('marketplace.addOptionalNotes')}
                    rows="3"
                    className="scp-page-notes-textarea"
                  />
                  <div className="scp-page-form-actions">
                    <button
                      onClick={() => setShowApprovalForm(false)}
                      className="scp-page-form-btn-cancel"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      onClick={handleApproveCart}
                      disabled={isApproving}
                      className="scp-page-form-btn-approve"
                    >
                      {isApproving ? t('common.loading') : t('common.approve')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer note */}
        <div className="scp-page-footer-note">
          <p>
            {t('marketplace.thisCartIsBeingSharedWithYou')}
          </p>
        </div>
      </div>
    </>
  );
}
