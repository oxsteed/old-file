// Shared constants and formatters for Business Hub components

export const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
];

export const BIZ_TYPES = [
  { value: 'Handyman',       labelKey: 'bizTypeHandyman' },
  { value: 'Plumbing',       labelKey: 'bizTypePlumbing' },
  { value: 'Electrical',     labelKey: 'bizTypeElectrical' },
  { value: 'HVAC',           labelKey: 'bizTypeHVAC' },
  { value: 'Landscaping',    labelKey: 'bizTypeLandscaping' },
  { value: 'Cleaning',       labelKey: 'bizTypeCleaning' },
  { value: 'Painting',       labelKey: 'bizTypePainting' },
  { value: 'Carpentry',      labelKey: 'bizTypeCarpentry' },
  { value: 'Roofing',        labelKey: 'bizTypeRoofing' },
  { value: 'Flooring',       labelKey: 'bizTypeFlooring' },
  { value: 'Moving',         labelKey: 'bizTypeMoving' },
  { value: 'Pest Control',   labelKey: 'bizTypePestControl' },
  { value: 'Pool Service',   labelKey: 'bizTypePoolService' },
  { value: 'Auto Repair',    labelKey: 'bizTypeAutoRepair' },
  { value: 'General Labor',  labelKey: 'bizTypeGeneralLabor' },
  { value: 'Other',          labelKey: 'bizTypeOther' },
];

export function fmt$(n) {
  if (!n && n !== 0) return '—';
  return '$' + parseFloat(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtDate(d) {
  if (!d) return '—';
  const dateOnly = String(d).split('T')[0];
  return new Date(dateOnly + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtMonth(m) {
  if (!m) return '';
  const [y, mo] = m.split('-');
  return new Date(+y, +mo - 1).toLocaleString('en-US', { month: 'short' });
}
