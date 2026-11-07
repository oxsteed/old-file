// EmployedByRestaurant — the "Employed by [restaurant name]" line for
// employee pay surfaces (Phase 3). A worker reading a pay surface must see
// the restaurant as their employer, never OxSteed. Track B renders this on
// My tips, My pay, and pay stubs; Track A (the portal shell) renders it on
// the My pay placeholder until the real pay surface lands.
import { useTranslation } from 'react-i18next';

export default function EmployedByRestaurant({ restaurantName }) {
  const { t } = useTranslation();
  if (!restaurantName) return null;
  return (
    <p className="ep-employed-by">
      {t('food.employeePortal.employedBy', { restaurant: restaurantName })}
    </p>
  );
}
