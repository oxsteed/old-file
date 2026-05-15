/**
 * Product Management Component
 * Business owner interface for managing product catalog, inventory, and variants
 */

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import './ProductManagement.css';

export default function ProductManagement({ businessId }) {
  const { t } = useTranslation();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showNewProductModal, setShowNewProductModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [showVariantModal, setShowVariantModal] = useState(false);
  const [lowStockAlerts, setLowStockAlerts] = useState([]);

  // Form state
  const [productForm, setProductForm] = useState({
    name: '',
    category: '',
    description: '',
    price: '',
    cost: '',
    sku: '',
  });

  const [variantForm, setVariantForm] = useState({
    variantName: '',
    sku: '',
    priceAdjustment: 0,
    stock: 0,
    reorderLevel: 10,
  });

  // Load products and alerts on mount
  useEffect(() => {
    loadProducts();
    loadLowStockAlerts();
  }, [businessId]);

  const loadProducts = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`/api/businesses/${businessId}/products`, {
        params: { limit: 100 },
      });
      setProducts(response.data.data);
    } catch (error) {
      console.error('Failed to load products:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadLowStockAlerts = async () => {
    try {
      const response = await axios.get(
        `/api/businesses/${businessId}/products/alerts/low-stock`
      );
      setLowStockAlerts(response.data.data);
    } catch (error) {
      console.error('Failed to load alerts:', error);
    }
  };

  const handleCreateProduct = async (e) => {
    e.preventDefault();
    if (!productForm.name || !productForm.category || !productForm.sku) {
      alert(t('common.fillRequiredFields'));
      return;
    }

    try {
      const response = await axios.post(`/api/businesses/${businessId}/products`, {
        name: productForm.name,
        category: productForm.category,
        description: productForm.description,
        price: parseFloat(productForm.price),
        cost: productForm.cost ? parseFloat(productForm.cost) : 0,
        sku: productForm.sku,
      });

      setProducts([response.data.data, ...products]);
      setProductForm({
        name: '',
        category: '',
        description: '',
        price: '',
        cost: '',
        sku: '',
      });
      setShowNewProductModal(false);
      alert(t('products.created'));
    } catch (error) {
      console.error('Failed to create product:', error);
      alert(t('common.errorCreating'));
    }
  };

  const handleUpdateProduct = async (productId, updates) => {
    try {
      await axios.put(`/api/businesses/${businessId}/products/${productId}`, updates);
      loadProducts();
      alert(t('common.updated'));
    } catch (error) {
      console.error('Failed to update product:', error);
      alert(t('common.failedToUpdate'));
    }
  };

  const handleDeleteProduct = async (productId) => {
    if (!window.confirm(t('common.confirmDelete'))) return;

    try {
      await axios.delete(`/api/businesses/${businessId}/products/${productId}`);
      setProducts(products.filter(p => p.id !== productId));
      alert(t('common.deleted'));
    } catch (error) {
      console.error('Failed to delete product:', error);
      alert(t('common.failedToDelete'));
    }
  };

  const handleCreateVariant = async (e) => {
    e.preventDefault();
    if (!selectedProduct || !variantForm.variantName || !variantForm.sku) {
      alert(t('common.fillRequiredFields'));
      return;
    }

    try {
      await axios.post(
        `/api/businesses/${businessId}/products/${selectedProduct.id}/variants`,
        {
          variantName: variantForm.variantName,
          sku: variantForm.sku,
          priceAdjustment: parseFloat(variantForm.priceAdjustment),
          stock: parseInt(variantForm.stock),
          reorderLevel: parseInt(variantForm.reorderLevel),
        }
      );

      setVariantForm({
        variantName: '',
        sku: '',
        priceAdjustment: 0,
        stock: 0,
        reorderLevel: 10,
      });
      setShowVariantModal(false);
      loadProducts();
      alert(t('products.variantCreated'));
    } catch (error) {
      console.error('Failed to create variant:', error);
      alert(t('common.errorCreating'));
    }
  };

  const handleUpdateInventory = async (variantId, quantityChange, reason) => {
    try {
      await axios.put(
        `/api/businesses/${businessId}/products/${selectedProduct.id}/variants/${variantId}/inventory`,
        {
          quantityChange: parseInt(quantityChange),
          reason,
        }
      );
      loadProducts();
      loadLowStockAlerts();
      alert(t('inventory.updated'));
    } catch (error) {
      console.error('Failed to update inventory:', error);
      alert(t('common.failedToUpdate'));
    }
  };

  return (
    <div className="product-management">
      {/* Header */}
      <div className="pm-header">
        <h2>{t('products.management')}</h2>
        <button
          className="pm-btn-primary"
          onClick={() => setShowNewProductModal(true)}
        >
          + {t('products.addProduct')}
        </button>
      </div>

      {/* Low Stock Alerts */}
      {lowStockAlerts.length > 0 && (
        <div className="pm-alerts">
          <h3>{t('inventory.lowStockAlerts')} ({lowStockAlerts.length})</h3>
          <div className="pm-alert-list">
            {lowStockAlerts.map(alert => (
              <div key={alert.variantId} className="pm-alert-item">
                <div className="pm-alert-info">
                  <strong>{alert.productName}</strong> - {alert.variantName}
                  <br />
                  <small>{t('inventory.sku')}: {alert.sku}</small>
                </div>
                <div className="pm-alert-status">
                  <span className="pm-stock-warning">
                    {alert.currentStock} / {alert.reorderLevel}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Products List */}
      <div className="pm-products">
        {loading ? (
          <p>{t('common.loading')}</p>
        ) : products.length === 0 ? (
          <div className="pm-empty">
            <p>{t('products.noProducts')}</p>
            <button
              className="pm-btn-secondary"
              onClick={() => setShowNewProductModal(true)}
            >
              {t('products.createFirst')}
            </button>
          </div>
        ) : (
          <table className="pm-table">
            <thead>
              <tr>
                <th>{t('common.name')}</th>
                <th>{t('products.category')}</th>
                <th>{t('products.sku')}</th>
                <th>{t('common.price')}</th>
                <th>{t('inventory.stock')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {products.map(product => (
                <tr key={product.id}>
                  <td>
                    <strong>{product.name}</strong>
                  </td>
                  <td>{product.category}</td>
                  <td className="pm-monospace">{product.sku || '-'}</td>
                  <td>${product.price?.toFixed(2)}</td>
                  <td>
                    <span className={product.totalStock === 0 ? 'pm-out-of-stock' : ''}>
                      {product.totalStock}
                    </span>
                  </td>
                  <td className="pm-actions">
                    <button
                      className="pm-btn-small"
                      onClick={() => setSelectedProduct(product)}
                      title={t('common.view')}
                    >
                      👁️
                    </button>
                    <button
                      className="pm-btn-small"
                      onClick={() => {
                        setSelectedProduct(product);
                        setShowVariantModal(true);
                      }}
                      title={t('products.addVariant')}
                    >
                      ➕
                    </button>
                    <button
                      className="pm-btn-small pm-btn-delete"
                      onClick={() => handleDeleteProduct(product.id)}
                      title={t('common.delete')}
                    >
                      🗑️
                    </button>
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
            <h3>{t('products.createNew')}</h3>
            <form onSubmit={handleCreateProduct}>
              <input
                type="text"
                placeholder={t('common.name')}
                value={productForm.name}
                onChange={e => setProductForm({ ...productForm, name: e.target.value })}
                required
              />
              <input
                type="text"
                placeholder={t('products.category')}
                value={productForm.category}
                onChange={e => setProductForm({ ...productForm, category: e.target.value })}
                required
              />
              <input
                type="text"
                placeholder={t('products.sku')}
                value={productForm.sku}
                onChange={e => setProductForm({ ...productForm, sku: e.target.value })}
                required
              />
              <input
                type="number"
                placeholder={t('common.price')}
                value={productForm.price}
                onChange={e => setProductForm({ ...productForm, price: e.target.value })}
                step="0.01"
                required
              />
              <input
                type="number"
                placeholder={t('products.cost')}
                value={productForm.cost}
                onChange={e => setProductForm({ ...productForm, cost: e.target.value })}
                step="0.01"
              />
              <textarea
                placeholder={t('common.description')}
                value={productForm.description}
                onChange={e => setProductForm({ ...productForm, description: e.target.value })}
                rows="3"
              />
              <div className="pm-modal-actions">
                <button type="button" onClick={() => setShowNewProductModal(false)}>
                  {t('common.cancel')}
                </button>
                <button type="submit" className="pm-btn-primary">
                  {t('common.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Variant Modal */}
      {showVariantModal && selectedProduct && (
        <div className="pm-modal-overlay" onClick={() => setShowVariantModal(false)}>
          <div className="pm-modal" onClick={e => e.stopPropagation()}>
            <h3>{t('products.addVariant')} - {selectedProduct.name}</h3>
            <form onSubmit={handleCreateVariant}>
              <input
                type="text"
                placeholder={t('products.variantName')}
                value={variantForm.variantName}
                onChange={e => setVariantForm({ ...variantForm, variantName: e.target.value })}
                required
              />
              <input
                type="text"
                placeholder={t('products.sku')}
                value={variantForm.sku}
                onChange={e => setVariantForm({ ...variantForm, sku: e.target.value })}
                required
              />
              <input
                type="number"
                placeholder={t('products.priceAdjustment')}
                value={variantForm.priceAdjustment}
                onChange={e => setVariantForm({ ...variantForm, priceAdjustment: e.target.value })}
                step="0.01"
              />
              <input
                type="number"
                placeholder={t('inventory.initialStock')}
                value={variantForm.stock}
                onChange={e => setVariantForm({ ...variantForm, stock: e.target.value })}
                required
              />
              <input
                type="number"
                placeholder={t('inventory.reorderLevel')}
                value={variantForm.reorderLevel}
                onChange={e => setVariantForm({ ...variantForm, reorderLevel: e.target.value })}
              />
              <div className="pm-modal-actions">
                <button type="button" onClick={() => setShowVariantModal(false)}>
                  {t('common.cancel')}
                </button>
                <button type="submit" className="pm-btn-primary">
                  {t('common.create')}
                </button>
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
            <button
              className="pm-btn-close"
              onClick={() => setSelectedProduct(null)}
              title={t('common.close')}
            >
              ✕
            </button>
          </div>

          {selectedProduct.variants && selectedProduct.variants.length > 0 && (
            <div className="pm-detail-section">
              <h4>{t('products.variants')} ({selectedProduct.variants.length})</h4>
              <table className="pm-variant-table">
                <thead>
                  <tr>
                    <th>{t('common.name')}</th>
                    <th>{t('products.sku')}</th>
                    <th>{t('inventory.stock')}</th>
                    <th>{t('inventory.reorderLevel')}</th>
                    <th>{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedProduct.variants.map(variant => (
                    <tr key={variant.id}>
                      <td>{variant.name}</td>
                      <td className="pm-monospace">{variant.sku}</td>
                      <td>
                        <input
                          type="number"
                          value={variant.stock}
                          onChange={e => {
                            const change = parseInt(e.target.value) - variant.stock;
                            handleUpdateInventory(
                              variant.id,
                              change,
                              'Manual adjustment'
                            );
                          }}
                        />
                      </td>
                      <td>{variant.reorderLevel}</td>
                      <td>
                        {variant.stock <= variant.reorderLevel && (
                          <span className="pm-alert-badge">{t('inventory.lowStock')}</span>
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
