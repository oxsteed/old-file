import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  createFoodCategory,
  createFoodMenuItem,
  createFoodModifierGroup,
  deleteFoodCategory,
  deleteFoodModifierGroup,
  duplicateFoodMenuItem,
  formatFoodMoney,
  getManagedFoodMenu,
  updateFoodCategory,
  updateFoodMenuItem,
  updateFoodModifierGroup,
  uploadFoodAsset,
} from '../../api/food';
import { apiErrorMessage } from './foodShared';

const blankItem = () => ({
  name: '',
  price: '',
  description: '',
  categoryId: '',
  imageUrl: '',
  tags: '',
  allergens: '',
  isAvailable: true,
  publicationStatus: 'published',
});

const blankModifier = () => ({
  id: null,
  name: '',
  required: false,
  maxSelect: 1,
  options: [{ name: '', price: '', isAvailable: true }],
});

function splitList(value) {
  return String(value || '').split(',').map((part) => part.trim()).filter(Boolean);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(value.trim());
      value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  if (!rows.length) return [];
  const headers = rows.shift().map((header) => header.toLowerCase().replace(/[^a-z]/g, ''));
  return rows.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] || ''])));
}

export default function RestaurantMenuManager({ t, restaurant }) {
  const [menuData, setMenuData] = useState({ menu: [], uncategorizedItems: [] });
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [itemEditor, setItemEditor] = useState(null);
  const [categoryEditor, setCategoryEditor] = useState(null);
  const [modifierEditor, setModifierEditor] = useState(null);
  const csvInputRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setMenuData(await getManagedFoodMenu(restaurant.id));
    } catch (error) {
      toast.error(apiErrorMessage(error, t('food.merchant.menuError', 'Could not load the menu')));
    } finally {
      setLoading(false);
    }
  }, [restaurant.id, t]);

  useEffect(() => {
    setSelectedIds(new Set());
    load();
  }, [load]);

  const sections = useMemo(() => {
    const categories = (menuData.menu || []).map((category) => ({ ...category, category }));
    const uncategorized = menuData.uncategorizedItems?.length
      ? [{ id: null, name: t('food.restaurant.otherItems', 'Other items'), items: menuData.uncategorizedItems, category: null }]
      : [];
    return [...categories, ...uncategorized].map((section) => ({
      ...section,
      items: (section.items || []).filter((item) => showArchived || !item.archived_at),
    }));
  }, [menuData, showArchived, t]);

  const allItems = useMemo(
    () => sections.flatMap((section) => section.items || []),
    [sections]
  );
  const activeItems = allItems.filter((item) => !item.archived_at);
  const draftCount = activeItems.filter((item) => item.publication_status === 'draft').length;
  const soldOutCount = activeItems.filter((item) => !item.is_available).length;

  const mutate = async (action, successMessage) => {
    setWorking(true);
    try {
      await action();
      if (successMessage) toast.success(successMessage);
      await load();
    } catch (error) {
      toast.error(apiErrorMessage(error, t('food.merchant.menuError', 'Could not update the menu')));
    } finally {
      setWorking(false);
    }
  };

  const toggleSelected = (itemId) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const applyBulk = (payload, message) => mutate(async () => {
    await Promise.all(Array.from(selectedIds).map((itemId) => updateFoodMenuItem(restaurant.id, itemId, payload)));
    setSelectedIds(new Set());
  }, message);

  const moveCategory = (category, direction) => {
    const activeCategories = (menuData.menu || []).filter((entry) => entry.is_active !== false);
    const index = activeCategories.findIndex((entry) => entry.id === category.id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= activeCategories.length) return;
    const reordered = [...activeCategories];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
    mutate(() => Promise.all(reordered.map((entry, sortOrder) => (
      updateFoodCategory(restaurant.id, entry.id, { sortOrder })
    ))));
  };

  const moveItem = (item, sectionItems, direction) => {
    const visible = sectionItems.filter((entry) => !entry.archived_at);
    const index = visible.findIndex((entry) => entry.id === item.id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= visible.length) return;
    const reordered = [...visible];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
    mutate(() => Promise.all(reordered.map((entry, sortOrder) => (
      updateFoodMenuItem(restaurant.id, entry.id, { sortOrder })
    ))));
  };

  const CSV_IMPORT_LIMIT = 300;

  const handleCsvImport = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const rows = parseCsv(await file.text());
    if (!rows.length) {
      toast.error(t('food.menuManager.csvEmpty', 'No menu rows were found in that CSV file.'));
      return;
    }
    const report = { imported: 0, truncated: rows.length > CSV_IMPORT_LIMIT, skipped: [] };
    const skipRow = (rowNumber, name, reason) => report.skipped.push({ rowNumber, name: name || '-', reason });
    await mutate(async () => {
      const categoryByName = new Map((menuData.menu || []).map((category) => [category.name.toLowerCase(), category.id]));
      let rowNumber = 1; // header is row 1
      for (const row of rows.slice(0, CSV_IMPORT_LIMIT)) {
        rowNumber += 1;
        const name = (row.name || row.item || row.itemname || '').trim();
        const price = Number(row.price || row.amount);
        if (!name) { skipRow(rowNumber, name, t('food.merchant.csvReasonNoName', 'missing name')); continue; }
        if (!Number.isFinite(price) || price < 0) { skipRow(rowNumber, name, t('food.merchant.csvReasonBadPrice', 'invalid price')); continue; }
        if (price === 0) { skipRow(rowNumber, name, t('food.merchant.csvReasonZeroPrice', 'price is $0')); continue; }
        if (price > 500) { skipRow(rowNumber, name, t('food.merchant.csvReasonHighPrice', 'price over $500 looks like a typo')); continue; }
        let categoryId = null;
        const categoryName = row.category?.trim();
        if (categoryName) {
          categoryId = categoryByName.get(categoryName.toLowerCase());
          if (!categoryId) {
            const category = await createFoodCategory(restaurant.id, { name: categoryName, sortOrder: categoryByName.size });
            categoryId = category.id;
            categoryByName.set(categoryName.toLowerCase(), categoryId);
          }
        }
        await createFoodMenuItem(restaurant.id, {
          name,
          priceCents: Math.round(price * 100),
          description: row.description || undefined,
          categoryId: categoryId || undefined,
          tags: splitList(row.tags),
          allergens: splitList(row.allergens),
          publicationStatus: 'published',
        });
        report.imported += 1;
      }
    });
    const reasonCounts = new Map();
    report.skipped.forEach((entry) => reasonCounts.set(entry.reason, (reasonCounts.get(entry.reason) || 0) + 1));
    const reasons = [...reasonCounts.entries()].map(([reason, count]) => `${count} ${reason}`).join(', ');
    const skippedText = report.skipped.length
      ? ` ${t('food.merchant.csvSkippedSummary', '{{count}} rows skipped: {{reasons}}', { count: report.skipped.length, reasons })}`
      : '';
    const truncatedText = report.truncated
      ? ` ${t('food.merchant.csvTruncated', 'Only the first {{limit}} rows were imported.', { limit: CSV_IMPORT_LIMIT })}`
      : '';
    if (report.imported === 0) {
      toast.error(t('food.merchant.csvNothingImported', 'No items were imported.{{skipped}}{{truncated}}', {
        skipped: skippedText,
        truncated: truncatedText,
      }));
    } else {
      toast.success(t('food.merchant.csvImportedSummary', '{{count}} items imported and published.{{skipped}}{{truncated}}', {
        count: report.imported,
        skipped: skippedText,
        truncated: truncatedText,
      }));
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob(['name,price,category,description,tags,allergens\nJerk Chicken Plate,14.99,Entrees,Served with rice,"popular,spicy",\n'], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'oxsteed-menu-template.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="fd-menu-manager-loading">{t('food.common.loading', 'Loading menu…')}</div>;

  return (
    <section className="fd-menu-manager" aria-labelledby="fd-menu-manager-title">
      <header className="fd-menu-manager-header">
        <div>
          <p className="fd-menu-manager-kicker">{t('food.menuManager.kicker', 'Menu workspace')}</p>
          <h2 id="fd-menu-manager-title">{t('food.merchant.menu', 'Menu')}</h2>
          <p>{t('food.menuManager.subtitle', 'Keep prices, availability, photos, options, and publishing in one place.')}</p>
        </div>
        <div className="fd-menu-manager-primary-actions">
          <Link className="fd-btn fd-btn-secondary" to={`/restaurants/r/${restaurant.id}`} target="_blank" rel="noreferrer">
            {t('food.menuManager.preview', 'Preview customer menu')}
          </Link>
          <button type="button" className="fd-btn" onClick={() => setItemEditor({ item: null, form: blankItem() })}>
            + {t('food.menuManager.addItem', 'Add item')}
          </button>
        </div>
      </header>

      <div className="fd-menu-manager-stats" aria-label={t('food.menuManager.summary', 'Menu summary')}>
        <span><strong>{activeItems.length}</strong> {t('food.menuManager.items', 'items')}</span>
        <span><strong>{draftCount}</strong> {t('food.menuManager.drafts', 'drafts')}</span>
        <span><strong>{soldOutCount}</strong> {t('food.menuManager.soldOut', 'sold out')}</span>
      </div>

      <div className="fd-menu-manager-tools">
        <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => setCategoryEditor({ id: null, name: '', description: '', isActive: true })}>
          + {t('food.merchant.addCategory', 'Add category')}
        </button>
        <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => csvInputRef.current?.click()}>
          {t('food.menuManager.importCsv', 'Import CSV')}
        </button>
        <button type="button" className="fd-btn fd-btn-ghost fd-btn-sm" onClick={downloadTemplate}>
          {t('food.menuManager.csvTemplate', 'Download template')}
        </button>
        <label className="fd-menu-manager-toggle">
          <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
          {t('food.menuManager.showArchived', 'Show archived')}
        </label>
        <input ref={csvInputRef} type="file" accept=".csv,text/csv" hidden onChange={handleCsvImport} />
      </div>

      {selectedIds.size > 0 && (
        <div className="fd-menu-bulkbar" role="region" aria-label={t('food.menuManager.bulkActions', 'Bulk actions')}>
          <strong>{t('food.menuManager.selectedCount', '{{count}} selected', { count: selectedIds.size })}</strong>
          <button type="button" onClick={() => applyBulk({ publicationStatus: 'published' }, t('food.menuManager.published', 'Items published'))}>{t('food.menuManager.publish', 'Publish')}</button>
          <button type="button" onClick={() => applyBulk({ isAvailable: false }, t('food.menuManager.soldOutUpdated', 'Items marked sold out'))}>{t('food.merchant.markSoldOut', 'Mark sold out')}</button>
          <button type="button" onClick={() => applyBulk({ archived: true }, t('food.menuManager.archived', 'Items archived'))}>{t('food.menuManager.archive', 'Archive')}</button>
          <button type="button" onClick={() => setSelectedIds(new Set())}>{t('food.common.cancel', 'Cancel')}</button>
        </div>
      )}

      {sections.length === 0 ? (
        <div className="fd-menu-manager-empty">
          <span aria-hidden>🍽️</span>
          <h3>{t('food.menuManager.emptyTitle', 'Build your first menu')}</h3>
          <p>{t('food.menuManager.emptyBody', 'Create a category or add an item. Only the name and price are required.')}</p>
          <button type="button" className="fd-btn" onClick={() => setItemEditor({ item: null, form: blankItem() })}>{t('food.menuManager.addFirst', 'Add first item')}</button>
        </div>
      ) : sections.map((section, sectionIndex) => (
        <article key={section.id ?? 'uncategorized'} className={`fd-menu-category${section.is_active === false ? ' fd-menu-category--archived' : ''}`}>
          <header className="fd-menu-category-header">
            <div>
              <h3>{section.name}</h3>
              <span>{t('food.menuManager.itemCount', '{{count}} items', { count: section.items.length })}</span>
            </div>
            {section.category && (
              <div className="fd-menu-category-actions">
                <button type="button" disabled={working || sectionIndex === 0} onClick={() => moveCategory(section, -1)} aria-label={t('food.menuManager.moveCategoryUp', 'Move category up')}>↑</button>
                <button type="button" disabled={working || sectionIndex === sections.length - 1} onClick={() => moveCategory(section, 1)} aria-label={t('food.menuManager.moveCategoryDown', 'Move category down')}>↓</button>
                <button type="button" onClick={() => setCategoryEditor({ id: section.id, name: section.name, description: section.description || '', isActive: section.is_active !== false, itemCount: section.items.length })}>{t('food.common.edit', 'Edit')}</button>
              </div>
            )}
          </header>

          <div className="fd-menu-owner-items">
            {section.items.length === 0 && <p className="fd-menu-category-empty">{t('food.menuManager.categoryEmpty', 'No items in this category yet.')}</p>}
            {section.items.map((item, itemIndex) => (
              <div key={item.id} className={`fd-menu-owner-item${item.archived_at ? ' fd-menu-owner-item--archived' : ''}`}>
                <label className="fd-menu-owner-select" aria-label={t('food.menuManager.selectItem', 'Select {{name}}', { name: item.name })}>
                  <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelected(item.id)} />
                </label>
                <div className="fd-menu-owner-thumb">
                  {item.image_url ? <img src={item.image_url} alt="" /> : <span aria-hidden>🍴</span>}
                </div>
                <div className="fd-menu-owner-copy">
                  <div className="fd-menu-owner-title-row">
                    <strong>{item.name}</strong>
                    <span>{formatFoodMoney(item.price_cents, restaurant.currency_code)}</span>
                  </div>
                  <p>{item.description || t('food.menuManager.noDescription', 'No description')}</p>
                  <div className="fd-menu-owner-badges">
                    <span className={item.publication_status === 'draft' ? 'fd-state-draft' : 'fd-state-live'}>{item.publication_status === 'draft' ? t('food.menuManager.draft', 'Draft') : t('food.menuManager.live', 'Live')}</span>
                    {!item.is_available && <span className="fd-state-soldout">{t('food.restaurant.soldOut', 'Sold out')}</span>}
                    {item.archived_at && <span>{t('food.menuManager.archivedLabel', 'Archived')}</span>}
                    {(item.modifierGroups?.length || 0) > 0 && <span>{t('food.menuManager.optionGroups', '{{count}} option groups', { count: item.modifierGroups.length })}</span>}
                  </div>
                </div>
                <div className="fd-menu-owner-actions">
                  <button type="button" disabled={working || itemIndex === 0} onClick={() => moveItem(item, section.items, -1)} aria-label={t('food.menuManager.moveItemUp', 'Move item up')}>↑</button>
                  <button type="button" disabled={working || itemIndex === section.items.length - 1} onClick={() => moveItem(item, section.items, 1)} aria-label={t('food.menuManager.moveItemDown', 'Move item down')}>↓</button>
                  <button type="button" onClick={() => setItemEditor({ item, form: itemToForm(item) })}>{t('food.common.edit', 'Edit')}</button>
                  <button type="button" onClick={() => mutate(() => duplicateFoodMenuItem(restaurant.id, item.id), t('food.menuManager.duplicated', 'Draft copy created'))}>{t('food.menuManager.duplicate', 'Duplicate')}</button>
                  <button type="button" onClick={() => mutate(() => updateFoodMenuItem(restaurant.id, item.id, { archived: !item.archived_at }), item.archived_at ? t('food.menuManager.restored', 'Item restored') : t('food.menuManager.archived', 'Item archived'))}>
                    {item.archived_at ? t('food.menuManager.restore', 'Restore') : t('food.menuManager.archive', 'Archive')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </article>
      ))}

      {itemEditor && (
        <ItemEditor
          t={t}
          restaurant={restaurant}
          categories={menuData.menu || []}
          editor={itemEditor}
          working={working}
          onClose={() => setItemEditor(null)}
          onSave={(form) => mutate(async () => {
            const payload = formToPayload(form);
            if (itemEditor.item) {
              await updateFoodMenuItem(restaurant.id, itemEditor.item.id, payload);
            } else {
              const created = await createFoodMenuItem(restaurant.id, payload);
              const groups = (form.modifierGroups || [])
                .map((groupForm) => modifierToPayload(groupForm))
                .filter((groupPayload) => groupPayload.name && groupPayload.options.length > 0);
              for (const groupPayload of groups) {
                await createFoodModifierGroup(restaurant.id, created.id, groupPayload);
              }
            }
            setItemEditor(null);
          }, t('food.menuManager.itemSaved', 'Menu item saved'))}
          onModifier={(group) => setModifierEditor({ item: itemEditor.item, group, form: modifierToForm(group) })}
          onDeleteModifier={(groupId) => mutate(() => deleteFoodModifierGroup(restaurant.id, groupId), t('food.menuManager.modifierDeleted', 'Option group deleted'))}
        />
      )}

      {categoryEditor && (
        <CategoryEditor
          t={t}
          editor={categoryEditor}
          working={working}
          onClose={() => setCategoryEditor(null)}
          onSave={(form) => mutate(async () => {
            if (form.id) await updateFoodCategory(restaurant.id, form.id, { name: form.name, description: form.description, isActive: form.isActive });
            else await createFoodCategory(restaurant.id, { name: form.name, description: form.description, sortOrder: menuData.menu?.length || 0 });
            setCategoryEditor(null);
          }, t('food.menuManager.categorySaved', 'Category saved'))}
          onDelete={(categoryId) => mutate(async () => {
            await deleteFoodCategory(restaurant.id, categoryId);
            setCategoryEditor(null);
          }, t('food.menuManager.categoryDeleted', 'Empty category deleted'))}
        />
      )}

      {modifierEditor && (
        <ModifierEditor
          t={t}
          editor={modifierEditor}
          currency={restaurant.currency_code}
          working={working}
          onClose={() => setModifierEditor(null)}
          onSave={(form) => mutate(async () => {
            const payload = modifierToPayload(form);
            if (modifierEditor.group?.id) await updateFoodModifierGroup(restaurant.id, modifierEditor.group.id, payload);
            else await createFoodModifierGroup(restaurant.id, modifierEditor.item.id, payload);
            setModifierEditor(null);
            setItemEditor(null);
          }, t('food.menuManager.modifierSaved', 'Option group saved'))}
        />
      )}
    </section>
  );
}

function itemToForm(item) {
  return {
    name: item.name || '',
    price: (Number(item.price_cents || 0) / 100).toFixed(2),
    description: item.description || '',
    categoryId: item.category_id ? String(item.category_id) : '',
    imageUrl: item.image_url || '',
    tags: (item.tags || []).join(', '),
    allergens: (item.allergens || []).join(', '),
    isAvailable: item.is_available !== false,
    publicationStatus: item.publication_status || 'published',
  };
}

function formToPayload(form) {
  return {
    name: form.name.trim(),
    priceCents: Math.round(Number(form.price) * 100),
    description: form.description.trim() || '',
    categoryId: form.categoryId ? Number(form.categoryId) : null,
    imageUrl: form.imageUrl || '',
    tags: splitList(form.tags),
    allergens: splitList(form.allergens),
    isAvailable: form.isAvailable,
    publicationStatus: form.publicationStatus,
  };
}

function modifierToForm(group) {
  if (!group) return blankModifier();
  return {
    id: group.id,
    name: group.name || '',
    required: group.isRequired === true,
    maxSelect: Number(group.maxSelect || 1),
    options: (group.options || []).map((option) => ({
      name: option.name || '',
      price: (Number(option.priceDeltaCents || 0) / 100).toFixed(2),
      isAvailable: option.isAvailable !== false,
    })),
  };
}

function modifierToPayload(form) {
  return {
    name: form.name.trim(),
    minSelect: form.required ? 1 : 0,
    maxSelect: Math.max(1, Number(form.maxSelect) || 1),
    isRequired: form.required,
    options: form.options.filter((option) => option.name.trim()).map((option) => ({
      name: option.name.trim(),
      priceDeltaCents: Math.round(Number(option.price || 0) * 100),
      isAvailable: option.isAvailable,
    })),
  };
}

function ItemEditor({ t, restaurant, categories, editor, working, onClose, onSave, onModifier, onDeleteModifier }) {
  const [form, setForm] = useState(editor.form);
  const [uploading, setUploading] = useState(false);
  // For brand-new items, modifier groups are collected locally and created
  // right after the item, so the whole item saves in one pass.
  const [pendingGroups, setPendingGroups] = useState([]);
  const [pendingEditor, setPendingEditor] = useState(null); // { index: number|null, form }
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));
  const valid = form.name.trim() && Number.isFinite(Number(form.price)) && Number(form.price) >= 0;
  const priceValue = Number(form.price);
  const showZeroPriceWarning = form.price !== '' && priceValue === 0;
  const showHighPriceWarning = Number.isFinite(priceValue) && priceValue > 500;
  const [highPriceConfirmed, setHighPriceConfirmed] = useState(false);
  const canSave = valid && (!showHighPriceWarning || highPriceConfirmed);
  const uploadImage = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const uploaded = await uploadFoodAsset(file, 'food-menu-item');
      setForm((current) => ({ ...current, imageUrl: uploaded?.url || current.imageUrl }));
    } catch (error) {
      toast.error(apiErrorMessage(error, t('food.menuManager.imageError', 'Could not upload the image')));
    } finally {
      setUploading(false);
    }
  };
  return (<>
    <div className="fd-owner-editor-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="fd-owner-editor" onSubmit={(event) => { event.preventDefault(); if (canSave) onSave({ ...form, modifierGroups: pendingGroups }); }}>
        <header><div><p>{editor.item ? t('food.menuManager.editItem', 'Edit item') : t('food.menuManager.newItem', 'New item')}</p><h3>{form.name || t('food.menuManager.untitledItem', 'Untitled item')}</h3></div><button type="button" onClick={onClose} aria-label={t('food.common.close', 'Close')}>×</button></header>
        <div className="fd-owner-editor-body">
          <div className="fd-menu-editor-grid">
            <div className="fd-field"><label htmlFor="menu-item-name">{t('food.merchant.itemName', 'Item name')} *</label><input id="menu-item-name" value={form.name} onChange={set('name')} maxLength={160} autoFocus /></div>
            <div className="fd-field"><label htmlFor="menu-item-price">{t('food.merchant.itemPrice', 'Price')} ({restaurant.currency_code}) *</label><input id="menu-item-price" value={form.price} onChange={(event) => { set('price')(event); setHighPriceConfirmed(false); }} type="number" min="0" step="0.01" inputMode="decimal" />
              {showZeroPriceWarning && <small className="fd-price-warning">{t('food.merchant.zeroPriceWarning', 'This item is priced at $0. Customers can order it for free.')}</small>}
              {showHighPriceWarning && (
                <span className="fd-price-warning">
                  <small>{t('food.merchant.highPriceWarning', 'That price looks like a typo. Did you mean {{suggested}}?', { suggested: formatFoodMoney(Math.round(priceValue / 100) * 100, restaurant.currency_code) })}</small>
                  <label className="fd-menu-manager-toggle"><input type="checkbox" checked={highPriceConfirmed} onChange={(event) => setHighPriceConfirmed(event.target.checked)} />{t('food.merchant.highPriceConfirm', 'The price is correct')}</label>
                </span>
              )}
            </div>
          </div>
          <div className="fd-field"><label htmlFor="menu-item-description">{t('food.merchant.itemDescription', 'Description')}</label><textarea id="menu-item-description" value={form.description} onChange={set('description')} rows={3} maxLength={2000} /></div>
          <div className="fd-menu-editor-grid">
            <div className="fd-field"><label htmlFor="menu-item-category">{t('food.merchant.itemCategory', 'Category')}</label><select id="menu-item-category" value={form.categoryId} onChange={set('categoryId')}><option value="">{t('food.merchant.noCategory', 'No category')}</option>{categories.filter((category) => category.is_active !== false).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
            <div className="fd-field"><label htmlFor="menu-item-status">{t('food.menuManager.publishStatus', 'Publishing')}</label><select id="menu-item-status" value={form.publicationStatus} onChange={set('publicationStatus')}><option value="published">{t('food.menuManager.publishedNow', 'Published')}</option><option value="draft">{t('food.menuManager.draftNotVisible', 'Draft: not visible')}</option></select></div>
          </div>
          <div className="fd-menu-image-field">
            <div className="fd-menu-image-preview">{form.imageUrl ? <img src={form.imageUrl} alt="" /> : <span aria-hidden>📷</span>}</div>
            <div><label className="fd-btn fd-btn-secondary fd-btn-sm">{uploading ? t('food.common.saving', 'Uploading…') : t('food.menuManager.uploadPhoto', 'Upload photo')}<input type="file" accept="image/*" onChange={uploadImage} hidden disabled={uploading} /></label>{form.imageUrl && <button type="button" className="fd-btn fd-btn-ghost fd-btn-sm" onClick={() => setForm((current) => ({ ...current, imageUrl: '' }))}>{t('food.common.remove', 'Remove')}</button>}</div>
          </div>
          <details className="fd-menu-editor-advanced"><summary>{t('food.menuManager.dietaryDetails', 'Dietary details')}</summary><div className="fd-menu-editor-grid"><div className="fd-field"><label htmlFor="menu-item-tags">{t('food.menuManager.tags', 'Tags')}</label><input id="menu-item-tags" value={form.tags} onChange={set('tags')} placeholder="vegan, spicy, popular" /></div><div className="fd-field"><label htmlFor="menu-item-allergens">{t('food.menuManager.allergens', 'Allergens')}</label><input id="menu-item-allergens" value={form.allergens} onChange={set('allergens')} placeholder="milk, peanuts, wheat" /></div></div></details>
          <label className="fd-owner-switch"><input type="checkbox" checked={form.isAvailable} onChange={set('isAvailable')} /><span><strong>{t('food.menuManager.availableNow', 'Available for ordering')}</strong><small>{t('food.menuManager.availableHint', 'Turn this off to mark the item sold out without removing it.')}</small></span></label>
          {editor.item && <section className="fd-modifier-summary"><div className="fd-modifier-summary-head"><div><h4>{t('food.menuManager.optionsTitle', 'Options and modifiers')}</h4><p>{t('food.menuManager.optionsHint', 'Sizes, add-ons, sides, preparation choices, and extras.')}</p></div><button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => onModifier(null)}>+ {t('food.menuManager.addOptionGroup', 'Add group')}</button></div>{(editor.item.modifierGroups || []).map((group) => <div className="fd-modifier-summary-row" key={group.id}><div><strong>{group.name}</strong><span>{t('food.menuManager.optionsCount', '{{count}} options', { count: group.options?.length || 0 })}{group.isRequired ? ` · ${t('food.menuManager.required', 'Required')}` : ''}</span></div><div><button type="button" onClick={() => onModifier(group)}>{t('food.common.edit', 'Edit')}</button><button type="button" onClick={() => onDeleteModifier(group.id)}>{t('food.common.delete', 'Delete')}</button></div></div>)}</section>}
          {!editor.item && (
            <section className="fd-modifier-summary">
              <div className="fd-modifier-summary-head">
                <div><h4>{t('food.menuManager.optionsTitle', 'Options and modifiers')}</h4><p>{t('food.menuManager.optionsHint', 'Sizes, add-ons, sides, preparation choices, and extras.')}</p></div>
                <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => setPendingEditor({ index: null, form: blankModifier() })}>
                  + {t('food.menuManager.addOptionGroup', 'Add group')}
                </button>
              </div>
              {pendingGroups.map((group, index) => (
                <div className="fd-modifier-summary-row" key={index}>
                  <div><strong>{group.name || t('food.menuManager.newOptionGroup', 'New option group')}</strong><span>{t('food.menuManager.optionsCount', '{{count}} options', { count: group.options.filter((option) => option.name.trim()).length })}{group.required ? ` · ${t('food.menuManager.required', 'Required')}` : ''}</span></div>
                  <div>
                    <button type="button" onClick={() => setPendingEditor({ index, form: group })}>{t('food.common.edit', 'Edit')}</button>
                    <button type="button" onClick={() => setPendingGroups((current) => current.filter((_, i) => i !== index))}>{t('food.common.delete', 'Delete')}</button>
                  </div>
                </div>
              ))}
              {pendingGroups.length === 0 && <p className="fd-card-meta">{t('food.merchant.noOptionGroups', 'No option groups yet. Add sizes, add-ons, or choices before saving.')}</p>}
            </section>
          )}
        </div>
        <footer><button type="button" className="fd-btn fd-btn-secondary" onClick={onClose}>{t('food.common.cancel', 'Cancel')}</button><button className="fd-btn" type="submit" disabled={!canSave || working || uploading}>{working ? t('food.common.saving', 'Saving…') : t('food.common.save', 'Save item')}</button></footer>
      </form>
    </div>
    {pendingEditor && (
      <ModifierEditor
        t={t}
        editor={pendingEditor}
        currency={restaurant.currency_code}
        working={false}
        onClose={() => setPendingEditor(null)}
        onSave={(groupForm) => {
          setPendingGroups((current) => (pendingEditor.index == null
            ? [...current, groupForm]
            : current.map((group, index) => (index === pendingEditor.index ? groupForm : group))));
          setPendingEditor(null);
        }}
      />
    )}
  </>);
}

function CategoryEditor({ t, editor, working, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(editor);
  return <div className="fd-modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="fd-modal" onSubmit={(event) => { event.preventDefault(); if (form.name.trim()) onSave(form); }}><h3>{form.id ? t('food.menuManager.editCategory', 'Edit category') : t('food.menuManager.newCategory', 'New category')}</h3><div className="fd-field"><label htmlFor="menu-category-name">{t('food.menuManager.categoryName', 'Category name')} *</label><input id="menu-category-name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} autoFocus maxLength={120} /></div><div className="fd-field"><label htmlFor="menu-category-description">{t('food.menuManager.categoryDescription', 'Description')}</label><textarea id="menu-category-description" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} rows={2} /></div>{form.id && <label className="fd-owner-switch"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))} /><span><strong>{t('food.menuManager.categoryVisible', 'Category visible')}</strong><small>{t('food.menuManager.categoryVisibleHint', 'Hidden categories and their items do not appear to customers.')}</small></span></label>}{form.id && form.itemCount > 0 && <p className="fd-helper-text">{t('food.menuManager.categoryDeleteHint', 'This category contains items. Hide it to remove it from the customer menu, or move its items before deleting it.')}</p>}<div className="fd-row" style={{ justifyContent: 'space-between' }}>{form.id && form.itemCount === 0 ? <button type="button" className="fd-btn fd-btn-danger" onClick={() => onDelete(form.id)}>{t('food.menuManager.deleteEmptyCategory', 'Delete empty category')}</button> : <span />}<span className="fd-row"><button type="button" className="fd-btn fd-btn-secondary" onClick={onClose}>{t('food.common.cancel', 'Cancel')}</button><button className="fd-btn" disabled={!form.name.trim() || working}>{t('food.common.save', 'Save')}</button></span></div></form></div>;
}

function ModifierEditor({ t, editor, currency, working, onClose, onSave }) {
  const [form, setForm] = useState(editor.form);
  const updateOption = (index, patch) => setForm((current) => ({ ...current, options: current.options.map((option, optionIndex) => optionIndex === index ? { ...option, ...patch } : option) }));
  const valid = form.name.trim() && form.options.some((option) => option.name.trim());
  return <div className="fd-owner-editor-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="fd-owner-editor fd-modifier-editor" onSubmit={(event) => { event.preventDefault(); if (valid) onSave(form); }}><header><div><p>{t('food.menuManager.optionGroup', 'Option group')}</p><h3>{form.name || t('food.menuManager.newOptionGroup', 'New option group')}</h3></div><button type="button" onClick={onClose}>×</button></header><div className="fd-owner-editor-body"><div className="fd-field"><label htmlFor="modifier-name">{t('food.menuManager.groupName', 'Group name')} *</label><input id="modifier-name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Choose a size" autoFocus /></div><div className="fd-menu-editor-grid"><label className="fd-owner-switch"><input type="checkbox" checked={form.required} onChange={(event) => setForm((current) => ({ ...current, required: event.target.checked }))} /><span><strong>{t('food.menuManager.customerMustChoose', 'Customer must choose')}</strong><small>{t('food.menuManager.requiredChoiceHint', 'At least one option will be required.')}</small></span></label><div className="fd-field"><label htmlFor="modifier-max">{t('food.merchant.maxSelect', 'Maximum selections')}</label><input id="modifier-max" type="number" min="1" max="30" value={form.maxSelect} onChange={(event) => setForm((current) => ({ ...current, maxSelect: event.target.value }))} /></div></div><div className="fd-modifier-options-head"><h4>{t('food.menuManager.optionRows', 'Options')}</h4><button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => setForm((current) => ({ ...current, options: [...current.options, { name: '', price: '', isAvailable: true }] }))}>+ {t('food.menuManager.addOption', 'Add option')}</button></div><div className="fd-modifier-option-list">{form.options.map((option, index) => <div className="fd-modifier-option-row" key={index}><input aria-label={t('food.menuManager.optionName', 'Option name')} value={option.name} onChange={(event) => updateOption(index, { name: event.target.value })} placeholder="Large" /><div className="fd-modifier-price-input"><span>{currency}</span><input aria-label={t('food.menuManager.extraPrice', 'Extra price')} type="number" step="0.01" value={option.price} onChange={(event) => updateOption(index, { price: event.target.value })} placeholder="0.00" /></div><label title={t('food.menuManager.optionAvailable', 'Available')}><input type="checkbox" checked={option.isAvailable} onChange={(event) => updateOption(index, { isAvailable: event.target.checked })} /></label><button type="button" aria-label={t('food.common.remove', 'Remove')} onClick={() => setForm((current) => ({ ...current, options: current.options.filter((_, optionIndex) => optionIndex !== index) }))}>×</button></div>)}</div></div><footer><button type="button" className="fd-btn fd-btn-secondary" onClick={onClose}>{t('food.common.cancel', 'Cancel')}</button><button className="fd-btn" disabled={!valid || working}>{working ? t('food.common.saving', 'Saving…') : t('food.common.save', 'Save group')}</button></footer></form></div>;
}
