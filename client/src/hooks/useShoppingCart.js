import { useState, useCallback, useEffect } from 'react';
import { cartApi, shareApi } from '../api/marketplaceApi';
import { toast } from 'sonner';

/**
 * Custom hook for managing shopping cart state and operations
 * Provides cart CRUD, item management, templates, and sharing
 */
export const useShoppingCart = (cartId) => {
  const [cart, setCart] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Fetch cart details
  const fetchCart = useCallback(async () => {
    if (!cartId) return;

    setLoading(true);
    setError(null);

    try {
      const { data } = await cartApi.getCart(cartId);
      setCart(data);
      setItems(data.items || []);
    } catch (err) {
      const message = err.response?.data?.error || 'Failed to load cart';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [cartId]);

  // Fetch cart on mount or when cartId changes
  useEffect(() => {
    if (cartId) {
      fetchCart();
    }
  }, [cartId, fetchCart]);

  // Add item to cart
  const addItem = useCallback(
    async (productId, quantity = 1, notes) => {
      try {
        const { data } = await cartApi.addItem(cartId, productId, quantity, notes);
        setItems([...items, data]);
        toast.success('Item added to cart');
        return data;
      } catch (err) {
        const message = err.response?.data?.error || 'Failed to add item';
        toast.error(message);
        throw err;
      }
    },
    [cartId, items]
  );

  // Update item in cart
  const updateItem = useCallback(
    async (itemId, quantity, notes) => {
      try {
        const { data } = await cartApi.updateItem(cartId, itemId, quantity, notes);
        setItems(items.map((item) => (item.id === itemId ? { ...item, ...data } : item)));
        toast.success('Item updated');
        return data;
      } catch (err) {
        const message = err.response?.data?.error || 'Failed to update item';
        toast.error(message);
        throw err;
      }
    },
    [cartId, items]
  );

  // Remove item from cart
  const removeItem = useCallback(
    async (itemId) => {
      try {
        await cartApi.removeItem(cartId, itemId);
        setItems(items.filter((item) => item.id !== itemId));
        toast.success('Item removed');
      } catch (err) {
        const message = err.response?.data?.error || 'Failed to remove item';
        toast.error(message);
        throw err;
      }
    },
    [cartId, items]
  );

  // Update cart metadata
  const updateCart = useCallback(
    async (name, description, status) => {
      try {
        const { data } = await cartApi.updateCart(cartId, name, description, status);
        setCart({ ...cart, ...data });
        toast.success('Cart updated');
        return data;
      } catch (err) {
        const message = err.response?.data?.error || 'Failed to update cart';
        toast.error(message);
        throw err;
      }
    },
    [cartId, cart]
  );

  // Delete cart
  const deleteCart = useCallback(async () => {
    try {
      await cartApi.deleteCart(cartId);
      toast.success('Cart deleted');
      setCart(null);
      setItems([]);
    } catch (err) {
      const message = err.response?.data?.error || 'Failed to delete cart';
      toast.error(message);
      throw err;
    }
  }, [cartId]);

  // Save as template
  const saveAsTemplate = useCallback(
    async (templateName) => {
      try {
        const { data } = await cartApi.saveAsTemplate(cartId, templateName);
        setCart({ ...cart, ...data, is_template: true });
        toast.success('Cart saved as template');
        return data;
      } catch (err) {
        const message = err.response?.data?.error || 'Failed to save template';
        toast.error(message);
        throw err;
      }
    },
    [cartId, cart]
  );

  // Share cart
  const shareCart = useCallback(
    async (customerId, canModify = true, expiresInDays) => {
      try {
        const { data } = await shareApi.shareCart(
          cartId,
          customerId,
          canModify,
          expiresInDays
        );
        toast.success('Cart shared successfully');
        return data;
      } catch (err) {
        const message = err.response?.data?.error || 'Failed to share cart';
        toast.error(message);
        throw err;
      }
    },
    [cartId]
  );

  // Calculate totals
  const calculateTotals = useCallback(() => {
    const subtotal = items.reduce((sum, item) => {
      return sum + (item.unit_price_cents || 0) * item.quantity;
    }, 0);

    const tax = Math.round(subtotal * 0.1); // Simplified 10% tax
    const total = subtotal + tax;

    return {
      subtotal,
      tax,
      total,
      subtotalFormatted: (subtotal / 100).toFixed(2),
      taxFormatted: (tax / 100).toFixed(2),
      totalFormatted: (total / 100).toFixed(2),
    };
  }, [items]);

  return {
    // State
    cart,
    items,
    loading,
    error,

    // Actions
    addItem,
    updateItem,
    removeItem,
    updateCart,
    deleteCart,
    saveAsTemplate,
    shareCart,
    fetchCart,

    // Utilities
    calculateTotals,
    itemCount: items.length,
  };
};

export default useShoppingCart;
