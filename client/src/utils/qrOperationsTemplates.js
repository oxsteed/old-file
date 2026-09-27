export const QR_OPERATION_TEMPLATES = [
  {
    key: 'custom',
    workspace: 'custom',
    titleKey: 'qrGenerator.operations.customTitle',
    descriptionKey: 'qrGenerator.operations.customDescription',
    categoryKey: 'qrGenerator.operations.categoryCustom',
    icon: 'sparkles',
    fields: [],
  },
  {
    key: 'warehouse-location',
    workspace: 'warehouse',
    titleKey: 'qrGenerator.operations.locationTitle',
    descriptionKey: 'qrGenerator.operations.locationDescription',
    categoryKey: 'qrGenerator.operations.categoryWarehouse',
    icon: 'map-pin',
    prefix: 'LOC',
    fields: [
      { key: 'site', labelKey: 'qrGenerator.operations.fields.site', placeholderKey: 'qrGenerator.operations.fields.sitePlaceholder' },
      { key: 'zone', labelKey: 'qrGenerator.operations.fields.zone', placeholderKey: 'qrGenerator.operations.fields.zonePlaceholder' },
      { key: 'aisle', labelKey: 'qrGenerator.operations.fields.aisle', placeholderKey: 'qrGenerator.operations.fields.aislePlaceholder' },
      { key: 'bin', labelKey: 'qrGenerator.operations.fields.bin', placeholderKey: 'qrGenerator.operations.fields.binPlaceholder' },
    ],
  },
  {
    key: 'dock-door',
    workspace: 'warehouse',
    titleKey: 'qrGenerator.operations.dockTitle',
    descriptionKey: 'qrGenerator.operations.dockDescription',
    categoryKey: 'qrGenerator.operations.categoryWarehouse',
    icon: 'warehouse',
    prefix: 'DOCK',
    fields: [
      { key: 'site', labelKey: 'qrGenerator.operations.fields.site', placeholderKey: 'qrGenerator.operations.fields.sitePlaceholder' },
      { key: 'door', labelKey: 'qrGenerator.operations.fields.door', placeholderKey: 'qrGenerator.operations.fields.doorPlaceholder' },
      { key: 'direction', labelKey: 'qrGenerator.operations.fields.direction', placeholderKey: 'qrGenerator.operations.fields.directionPlaceholder' },
      { key: 'contact', labelKey: 'qrGenerator.operations.fields.contact', placeholderKey: 'qrGenerator.operations.fields.contactPlaceholder' },
    ],
  },
  {
    key: 'inventory-bin',
    workspace: 'warehouse',
    titleKey: 'qrGenerator.operations.binTitle',
    descriptionKey: 'qrGenerator.operations.binDescription',
    categoryKey: 'qrGenerator.operations.categoryWarehouse',
    icon: 'package',
    prefix: 'BIN',
    fields: [
      { key: 'sku', labelKey: 'qrGenerator.operations.fields.sku', placeholderKey: 'qrGenerator.operations.fields.skuPlaceholder' },
      { key: 'lot', labelKey: 'qrGenerator.operations.fields.lot', placeholderKey: 'qrGenerator.operations.fields.lotPlaceholder' },
      { key: 'quantity', labelKey: 'qrGenerator.operations.fields.quantity', placeholderKey: 'qrGenerator.operations.fields.quantityPlaceholder' },
      { key: 'expiry', labelKey: 'qrGenerator.operations.fields.expiry', placeholderKey: 'qrGenerator.operations.fields.expiryPlaceholder' },
    ],
  },
  {
    key: 'pallet-asset',
    workspace: 'warehouse',
    titleKey: 'qrGenerator.operations.assetTitle',
    descriptionKey: 'qrGenerator.operations.assetDescription',
    categoryKey: 'qrGenerator.operations.categoryWarehouse',
    icon: 'layers',
    prefix: 'ASSET',
    fields: [
      { key: 'assetId', labelKey: 'qrGenerator.operations.fields.assetId', placeholderKey: 'qrGenerator.operations.fields.assetIdPlaceholder' },
      { key: 'description', labelKey: 'qrGenerator.operations.fields.description', placeholderKey: 'qrGenerator.operations.fields.descriptionPlaceholder' },
      { key: 'owner', labelKey: 'qrGenerator.operations.fields.owner', placeholderKey: 'qrGenerator.operations.fields.ownerPlaceholder' },
    ],
  },
  {
    key: 'restaurant-table',
    workspace: 'restaurant',
    titleKey: 'qrGenerator.operations.tableTitle',
    descriptionKey: 'qrGenerator.operations.tableDescription',
    categoryKey: 'qrGenerator.operations.categoryRestaurant',
    icon: 'utensils',
    prefix: 'TABLE',
    fields: [
      { key: 'restaurant', labelKey: 'qrGenerator.operations.fields.restaurant', placeholderKey: 'qrGenerator.operations.fields.restaurantPlaceholder' },
      { key: 'area', labelKey: 'qrGenerator.operations.fields.area', placeholderKey: 'qrGenerator.operations.fields.areaPlaceholder' },
      { key: 'table', labelKey: 'qrGenerator.operations.fields.table', placeholderKey: 'qrGenerator.operations.fields.tablePlaceholder' },
    ],
  },
  {
    key: 'kitchen-station',
    workspace: 'restaurant',
    titleKey: 'qrGenerator.operations.kitchenTitle',
    descriptionKey: 'qrGenerator.operations.kitchenDescription',
    categoryKey: 'qrGenerator.operations.categoryRestaurant',
    icon: 'chef-hat',
    prefix: 'KITCHEN',
    fields: [
      { key: 'restaurant', labelKey: 'qrGenerator.operations.fields.restaurant', placeholderKey: 'qrGenerator.operations.fields.restaurantPlaceholder' },
      { key: 'station', labelKey: 'qrGenerator.operations.fields.station', placeholderKey: 'qrGenerator.operations.fields.stationPlaceholder' },
      { key: 'shift', labelKey: 'qrGenerator.operations.fields.shift', placeholderKey: 'qrGenerator.operations.fields.shiftPlaceholder' },
    ],
  },
  {
    key: 'pickup-order',
    workspace: 'restaurant',
    titleKey: 'qrGenerator.operations.pickupTitle',
    descriptionKey: 'qrGenerator.operations.pickupDescription',
    categoryKey: 'qrGenerator.operations.categoryRestaurant',
    icon: 'shopping-bag',
    prefix: 'PICKUP',
    fields: [
      { key: 'restaurant', labelKey: 'qrGenerator.operations.fields.restaurant', placeholderKey: 'qrGenerator.operations.fields.restaurantPlaceholder' },
      { key: 'orderPrefix', labelKey: 'qrGenerator.operations.fields.orderPrefix', placeholderKey: 'qrGenerator.operations.fields.orderPrefixPlaceholder' },
      { key: 'handoff', labelKey: 'qrGenerator.operations.fields.handoff', placeholderKey: 'qrGenerator.operations.fields.handoffPlaceholder' },
    ],
  },
  {
    key: 'menu-promo',
    workspace: 'restaurant',
    titleKey: 'qrGenerator.operations.menuTitle',
    descriptionKey: 'qrGenerator.operations.menuDescription',
    categoryKey: 'qrGenerator.operations.categoryRestaurant',
    icon: 'megaphone',
    prefix: 'MENU',
    fields: [
      { key: 'restaurant', labelKey: 'qrGenerator.operations.fields.restaurant', placeholderKey: 'qrGenerator.operations.fields.restaurantPlaceholder' },
      { key: 'menuName', labelKey: 'qrGenerator.operations.fields.menuName', placeholderKey: 'qrGenerator.operations.fields.menuNamePlaceholder' },
      { key: 'offer', labelKey: 'qrGenerator.operations.fields.offer', placeholderKey: 'qrGenerator.operations.fields.offerPlaceholder' },
    ],
  },
];

export function getQrOperationTemplate(key) {
  return QR_OPERATION_TEMPLATES.find((template) => template.key === key) || QR_OPERATION_TEMPLATES[0];
}

export function getQrOperationDefaults(template) {
  return Object.fromEntries((template?.fields || []).map((field) => [field.key, '']));
}

export function buildQrOperationPayload(template, data) {
  if (!template || template.key === 'custom') return '';
  const fields = Object.fromEntries(
    (template.fields || [])
      .map((field) => [field.key, String(data?.[field.key] || '').replace(/[\r\n]+/g, ' ').trim()])
      .filter(([, value]) => value),
  );
  return [
    'OXSTEED-LABEL',
    `TYPE=${template.key}`,
    ...Object.entries(fields).map(([key, value]) => `${key.toUpperCase()}=${value}`),
  ].join('\n');
}
