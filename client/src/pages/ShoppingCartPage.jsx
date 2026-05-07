import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Trash2, Copy, Share2, Save, Plus, Loader, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import PageMeta from '../components/PageMeta';
import useShoppingCart from '../hooks/useShoppingCart';
import { shareApi } from '../api/marketplaceApi';
import '../styles/ShoppingCartPage.css';

export default function ShoppingCartPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { cartId } = useParams();
  const {
    cart,
    items,
    loading,
    addItem,
    updateItem,
    removeItem,
    updateCart,
    saveAsTemplate,
    shareCart,
    calculateTotals,
  } = useShoppingCart(cartId);

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [showShareModal, setShowShareModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [sharedCartId, setSharedCartId] = useState('');

  useEffect(() => {
    if (cart) {
      setEditName(cart.name || '');
      setEditDescription(cart.description || '');
    }
  }, [cart]);

  const handleUpdateCart = async () => {
    try {
      await updateCart(editName, editDescription);
      setIsEditing(false);
    } catch (err) {
      // Error already shown in hook
    }
  };

  const handleSaveAsTemplate = async () => {
    if (!templateName.trim()) {
      toast.error(t('marketplace.templateNameRequired'));
      return;
    }

    try {
      await saveAsTemplate(templateName);
      setShowTemplateModal(false);
      setTemplateName('');
      toast.success(t('marketplace.templateSaved'));
    } catch (err) {
      // Error already shown in hook
    }
  };

  const handleShareCart = async () => {
    try {
      const response = await shareCart(null, true);
      setShareUrl(response.shareUrl);
      setSharedCartId(response.sharedCartId);
      setShowShareModal(true);
    } catch (err) {
      // Error already shown in hook
    }
  };

  const copyShareLink = () => {
    navigator.clipboard.writeText(shareUrl);
    toast.success(t('marketplace.linkCopied'));
  };

  const totals = calculateTotals();

  if (loading) {
    return (
      <div className="scp-loading">
        <Loader className="scp-spinner" />
        <p>{t('common.loading')}</p>
      </div>
    );
  }

  if (!cart) {
    return (
      <div className="scp-empty">
        <p>{t('marketplace.cartNotFound')}</p>
        <button onClick={() => navigate('/products')} className="scp-back-btn">
          <ArrowLeft size={16} />
          {t('common.goBack')}
        </button>
      </div>
    );
  }

  return (
    <>
      <PageMeta title={cart.name || t('marketplace.myCart')} />

      <div className="scp-container">
        {/* Header */}
        <div className="scp-header">
          <button onClick={() => navigate(-1)} className="scp-back-btn">
            <ArrowLeft size={20} />
          </button>
          <div className="scp-header-content">
            {isEditing ? (
              <div className="scp-edit-header">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="scp-edit-name"
                  placeholder={t('marketplace.cartName')}
                />
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="scp-edit-description"
                  placeholder={t('marketplace.cartDescription')}
                  rows="2"
                />
                <div className="scp-edit-actions">
                  <button
                    onClick={() => setIsEditing(false)}
                    className="scp-edit-btn-cancel"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={handleUpdateCart}
                    className="scp-edit-btn-save"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div>
                  <h1>{cart.name}</h1>
                  {cart.description && (
                    <p className="scp-description">{cart.description}</p>
                  )}
                </div>
                <button
                  onClick={() => setIsEditing(true)}
                  className="scp-edit-btn"
                >
                  {t('common.edit')}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="scp-content">
          {/* Items Section */}
          <div className="scp-items-section">
            <h2>{t('marketplace.items')} ({items.length})</h2>

            {items.length === 0 ? (
              <div className="scp-empty-items">
                <p>{t('marketplace.noItems')}</p>
              </div>
            ) : (
              <div className="scp-items-list">
                {items.map((item) => (
                  <div key={item.id} className="scp-item">
                    {item.product_image_url && (
                      <img
                        src={item.product_image_url}
                        alt={item.product_name}
                        className="scp-item-image"
                      />
                    )}
                    <div className="scp-item-info">
                      <h3>{item.product_name}</h3>
                      {item.category && <p className="scp-item-category">{item.category}</p>}
                      {item.notes && <p className="scp-item-notes">{item.notes}</p>}
                    </div>

                    <div className="scp-item-quantity">
                      <button
                        onClick={() =>
                          updateItem(item.id, Math.max(1, item.quantity - 1))
                        }
                        className="scp-qty-btn"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={(e) =>
                          updateItem(item.id, Math.max(1, parseInt(e.target.value) || 1))
                        }
                        className="scp-qty-input"
                        min="1"
                      />
                      <button
                        onClick={() => updateItem(item.id, item.quantity + 1)}
                        className="scp-qty-btn"
                      >
                        +
                      </button>
                    </div>

                    <div className="scp-item-price">
                      ${((item.unit_price_cents || 0) / 100).toFixed(2)}
                    </div>

                    <div className="scp-item-total">
                      ${(((item.unit_price_cents || 0) * item.quantity) / 100).toFixed(2)}
                    </div>

                    <button
                      onClick={() => removeItem(item.id)}
                      className="scp-item-delete"
                      title={t('common.delete')}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Summary Section */}
          <div className="scp-summary-section">
            <div className="scp-summary">
              <h2>{t('marketplace.orderSummary')}</h2>

              <div className="scp-summary-row">
                <span>{t('marketplace.subtotal')}</span>
                <span>${totals.subtotalFormatted}</span>
              </div>

              <div className="scp-summary-row">
                <span>{t('marketplace.tax')}</span>
                <span>${totals.taxFormatted}</span>
              </div>

              <div className="scp-summary-row scp-summary-total">
                <span>{t('marketplace.total')}</span>
                <span>${totals.totalFormatted}</span>
              </div>

              {items.length > 0 && (
                <button
                  onClick={() => navigate(`/checkout/${cartId}`)}
                  className="scp-action-btn scp-action-checkout"
                  style={{ width: '100%', marginBottom: '0.75rem', background: '#ea580c', color: '#fff', fontWeight: 600 }}
                >
                  {t('marketplace.proceedToCheckout', { defaultValue: 'Proceed to Checkout' })}
                </button>
              )}

              <div className="scp-actions">
                <button
                  onClick={handleShareCart}
                  className="scp-action-btn scp-action-share"
                >
                  <Share2 size={18} />
                  {t('marketplace.shareCart')}
                </button>

                <button
                  onClick={() => setShowTemplateModal(true)}
                  className="scp-action-btn scp-action-template"
                >
                  <Save size={18} />
                  {t('marketplace.saveAsTemplate')}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Share Modal */}
        {showShareModal && shareUrl && (
          <div className="scp-modal-overlay" onClick={() => setShowShareModal(false)}>
            <div className="scp-modal" onClick={(e) => e.stopPropagation()}>
              <h2>{t('marketplace.shareYourCart')}</h2>
              <p>{t('marketplace.shareInstructions')}</p>

              <div className="scp-share-link-container">
                <input
                  type="text"
                  value={shareUrl}
                  readOnly
                  className="scp-share-link-input"
                />
                <button onClick={copyShareLink} className="scp-copy-btn">
                  <Copy size={18} />
                  {t('common.copy')}
                </button>
              </div>

              <button
                onClick={() => setShowShareModal(false)}
                className="scp-modal-close-btn"
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        )}

        {/* Template Modal */}
        {showTemplateModal && (
          <div className="scp-modal-overlay" onClick={() => setShowTemplateModal(false)}>
            <div className="scp-modal" onClick={(e) => e.stopPropagation()}>
              <h2>{t('marketplace.saveAsTemplate')}</h2>
              <input
                type="text"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder={t('marketplace.templateNamePlaceholder')}
                className="scp-modal-input"
                autoFocus
              />
              <div className="scp-modal-actions">
                <button
                  onClick={() => setShowTemplateModal(false)}
                  className="scp-modal-btn-cancel"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleSaveAsTemplate}
                  className="scp-modal-btn-save"
                >
                  {t('common.save')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
