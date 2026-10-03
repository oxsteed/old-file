/**
 * Product Management Tab
 * Business owner interface for managing product catalog, inventory, and variants.
 * Used as a tab inside BusinessHubPage.
 */

import React, { useState, useEffect, useCallback } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import '../../styles/ProductManagement.css';

export function ProductManagement({ businessId }) {
  const { t } = useTranslation();
  const [products, setProducts]               = useState([]);
  const [loading, setLoading]                 = useState(false);
  const [showNewProductModal, setShowNewProductModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [showVariantModal, setShowVariantModal] = useState(false);
  const [lowStockAlerts, setLowStockAlerts]   = useState([]);

  const [productForm, setProductForm] = useState({
    name: '', category: '', description: '', price: '', cost: '', sku: '',
  });
  const [variantForm, setVariantForm] = useState({
    variantName: '', sku: '', priceAdjustment: 0, stock: 0, reorderLevel: 10,
  });

  const loadProducts = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get(`/businesses/${businessId}/products`, {
        params: { limit: 100 },
      });
      setProducts(res.data.data || []);
    } catch {
      toast.error(t('common.failedToLoad'));
    } finally {
      setLoading(false);
    }
  }, [businessId, t]);

  const loadLowStockAlerts = useCallback(async () => {
    try {
      const res = await api.get(
        `/businesses/${businessId}/products/alerts/low-stock`
      );
      setLowStockAlerts(res.data.data || []);
    } catch {
      // Non-fatal — alerts are supplementary
    }
  }, [businessId]);

  useEffect(() => {
    loadProducts();
    loadLowStockAlerts();
  }, [loadProducts, loadLowStockAlerts]);

  const handleCreateProduct = async (e) => {
    e.preventDefault();
    if (!productForm.name || !productForm.category || !productForm.sku) {
      toast.error(t('common.fillRequiredFields'));
      return;
    }
    try {
      const res = await api.post(`/businesses/${businessId}/products`, {
        name:        productForm.name,
        category:    productForm.category,
        description: productForm.description,
        price:       parseFloat(productForm.price),
        cost:        productForm.cost ? parseFloat(productForm.cost) : 0,
        sku:         productForm.sku,
      });
      setProducts([res.data.data, ...products]);
      setProductForm({ name: '', category: '', description: '', price: '', cost: '', sku: '' });
      setShowNewProductModal(false);
      toast.success(t('products.created', { defaultValue: 'Product created' }));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('common.errorCreating'));
    }
  };

  const handleDeleteProduct = async (productId) => {
    if (!window.confirm(t('common.confirmDeleteProduct', { defaultValue: 'Delete this product?' }))) return;
    try {
      await api.delete(`/businesses/${businessId}/products/${productId}`);
      setProducts(products.filter(p => p.id !== productId));
      if (selectedProduct?.id === productId) setSelectedProduct(null);
      toast.success(t('common.deleted', { defaultValue: 'Deleted' }));
    } catch {
      toast.error(t('common.failedToDelete', { defaultValue: 'Failed to delete' }));
    }
  };

  const handleCreateVariant = async (e) => {
    e.preventDefault();
    if (!selectedProduct || !variantForm.variantName || !variantForm.sku) {
      toast.error(t('common.fillRequiredFields'));
      return;
    }
    try {
      await api.post(
        `/businesses/${businessId}/products/${selectedProduct.id}/variants`,
        {
          variantName:     variantForm.variantName,
          sku:             variantForm.sku,
          priceAdjustment: parseFloat(variantForm.priceAdjustment),
          stock:           parseInt(variantForm.stock),
          reorderLevel:    parseInt(variantForm.reorderLevel),
        }
      );
      setVariantForm({ variantName: '', sku: '', priceAdjustment: 0, stock: 0, reorderLevel: 10 });
      setShowVariantModal(false);
      loadProducts();
      toast.success(t('products.variantCreated', { defaultValue: 'Variant created' }));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('common.errorCreating'));
    }
  };

  const handleUpdateInventory = async (variantId, quantityChange, reason) => {
    try {
      await api.put(
        `/businesses/${businessId}/products/${selectedProduct.id}/variants/${variantId}/inventory`,
        { quantityChange: parseInt(quantityChange), reason }
      );
      loadProducts();
      loadLowStockAlerts();
      toast.success(t('inventory.updated', { defaultValue: 'Inventory updated' }));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('common.failedToUpdate'));
    }
  };

  return (
    <div className="product-management">
      {/* Header */}
      <div className="pm-header">
        <h2>{t('products.management', { defaultValue: 'Product Management' })}</h2>
        <button className="pm-btn-primary" onClick={() => setShowNewProductModal(true)}>
          + {t('products.addProduct', { defaultValue: 'Add Product' })}
        </button>
      </div>

      {/* Low Stock Alerts */}
      {lowStockAlerts.length > 0 && (
        <div className="pm-alerts">
          <h3>⚠️ {t('inventory.lowStockAlerts', { defaultValue: 'Low Stock Alerts' })} ({lowStockAlerts.length})</h3>
          <div className="pm-alert-list">
            {lowStockAlerts.map(alert => (
              <div key={alert.variantId} className="pm-alert-item">
                <span><strong>{alert.productName}</strong>: {alert.variantName} <small>({alert.sku})</small></span>
                <span className="pm-stock-warning">{alert.currentStock} / {alert.reorderLevel}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Products Table */}
      <div className="pm-products">
        {loading ? (
          <p className="pm-loading">{t('common.loading')}</p>
        ) : products.length === 0 ? (
          <div className="pm-empty">
            <p>{t('products.noProducts', { defaultValue: 'No products yet' })}</p>
            <button className="pm-btn-secondary" onClick={() => setShowNewProductModal(true)}>
              {t('products.createFirst', { defaultValue: 'Create your first product' })}
            </button>
          </div>
        ) : (
          <table className="pm-table">
            <thead>
              <tr>
                <th>{t('common.name')}</th>
                <th>{t('products.category', { defaultValue: 'Category' })}</th>
                <th>{t('products.sku', { defaultValue: 'SKU' })}</th>
                <th>{t('common.price')}</th>
                <th>{t('inventory.stock', { defaultValue: 'Stock' })}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {products.map(product => (
                <tr key={product.id}>
                  <td><strong>{product.name}</strong></td>
                  <td>{product.category}</td>
                  <td className="pm-monospace">{product.sku || '-'}</td>
                  <td>${product.price?.toFixed(2)}</td>
                  <td>
                    <span className={product.totalStock === 0 ? 'pm-out-of-stock' : ''}>
                      {product.totalStock}
                    </span>
                  </td>
                  <td className="pm-actions">
                    <button className="pm-btn-small" onClick={() => setSelectedProduct(product)} title={t('common.view')}>👁️</button>
                    <button className="pm-btn-small" onClick={() => { setSelectedProduct(product); setShowVariantModal(true); }} title={t('products.addVariant', { defaultValue: 'Add Variant' })}>➕</button>
                    <button className="pm-btn-small pm-btn-delete" onClick={() => handleDeleteProduct(product.id)} title={t('common.delete')}>🗑️</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* New Product Modal */}
      {showNewProductModal && (
        <div className="pm-modal-overlay" onClick={() => setShowNewProductModal(false)}>
          <div className="pm-modal" onClick={e => e.stopPropagation()}>
            <h3>{t('products.createNew', { defaultValue: 'New Product' })}</h3>
            <form onSubmit={handleCreateProduct}>
              <input type="text" placeholder={`${t('common.name')} *`} value={productForm.name} onChange={e => setProductForm({ ...productForm, name: e.target.value })} required />
              <input type="text" placeholder={`${t('products.category', { defaultValue: 'Category' })} *`} value={productForm.category} onChange={e => setProductForm({ ...productForm, category: e.target.value })} required />
              <input type="text" placeholder={`${t('products.sku', { defaultValue: 'SKU' })} *`} value={productForm.sku} onChange={e => setProductForm({ ...productForm, sku: e.target.value })} required />
              <input type="number" placeholder={`${t('common.price')} *`} value={productForm.price} onChange={e => setProductForm({ ...productForm, price: e.target.value })} step="0.01" min="0" required />
              <input type="number" placeholder={t('products.cost', { defaultValue: 'Cost (optional)' })} value={productForm.cost} onChange={e => setProductForm({ ...productForm, cost: e.target.value })} step="0.01" min="0" />
              <textarea placeholder={t('common.description')} value={productForm.description} onChange={e => setProductForm({ ...productForm, description: e.target.value })} rows="3" />
              <div className="pm-modal-actions">
                <button type="button" onClick={() => setShowNewProductModal(false)}>{t('common.cancel')}</button>
                <button type="submit" className="pm-btn-primary">{t('common.create')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Variant Modal */}
      {showVariantModal && selectedProduct && (
        <div className="pm-modal-overlay" onClick={() => setShowVariantModal(false)}>
          <div className="pm-modal" onClick={e => e.stopPropagation()}>
            <h3>{t('products.addVariant', { defaultValue: 'Add Variant' })}: {selectedProduct.name}</h3>
            <form onSubmit={handleCreateVariant}>
              <input type="text" placeholder={`${t('products.variantName', { defaultValue: 'Variant Name' })} *`} value={variantForm.variantName} onChange={e => setVariantForm({ ...variantForm, variantName: e.target.value })} required />
              <input type="text" placeholder={`${t('products.sku', { defaultValue: 'SKU' })} *`} value={variantForm.sku} onChange={e => setVariantForm({ ...variantForm, sku: e.target.value })} required />
              <input type="number" placeholder={t('products.priceAdjustment', { defaultValue: 'Price Adjustment ($)' })} value={variantForm.priceAdjustment} onChange={e => setVariantForm({ ...variantForm, priceAdjustment: e.target.value })} step="0.01" />
              <input type="number" placeholder={`${t('inventory.initialStock', { defaultValue: 'Initial Stock' })} *`} value={variantForm.stock} onChange={e => setVariantForm({ ...variantForm, stock: e.target.value })} min="0" required />
              <input type="number" placeholder={t('inventory.reorderLevel', { defaultValue: 'Reorder Level' })} value={variantForm.reorderLevel} onChange={e => setVariantForm({ ...variantForm, reorderLevel: e.target.value })} min="0" />
              <div className="pm-modal-actions">
                <button type="button" onClick={() => setShowVariantModal(false)}>{t('common.cancel')}</button>
                <button type="submit" className="pm-btn-primary">{t('common.create')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Product Detail Panel */}
      {selectedProduct && !showVariantModal && (
        <div className="pm-detail">
          <div className="pm-detail-header">
            <h3>{selectedProduct.name}</h3>
            <button className="pm-btn-close" onClick={() => setSelectedProduct(null)}>✕</button>
          </div>
          {selectedProduct.variants && selectedProduct.variants.length > 0 && (
            <div className="pm-detail-section">
              <h4>{t('products.variants', { defaultValue: 'Variants' })} ({selectedProduct.variants.length})</h4>
              <table className="pm-variant-table">
                <thead>
                  <tr>
                    <th>{t('common.name')}</th>
                    <th>SKU</th>
                    <th>{t('inventory.stock', { defaultValue: 'Stock' })}</th>
                    <th>{t('inventory.reorderLevel', { defaultValue: 'Reorder at' })}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {selectedProduct.variants.map(variant => (
                    <tr key={variant.id}>
                      <td>{variant.name}</td>
                      <td className="pm-monospace">{variant.sku}</td>
                      <td>{variant.stock}</td>
                      <td>{variant.reorderLevel}</td>
                      <td>
                        {variant.stock <= variant.reorderLevel && (
                          <span className="pm-alert-badge">{t('inventory.lowStock', { defaultValue: 'Low' })}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ProductManagement;
