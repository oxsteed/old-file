// Groups 5-6 business owner console (items 201-250). Each section is its own
// server-authorized panel; a section the caller cannot use renders its error.
import BusinessLaunchConsole from './BusinessLaunchConsole';
import OwnerOversight from './OwnerOversight';
import OwnerPolicies from './OwnerPolicies';
import OwnerFinance from './OwnerFinance';
import OwnerExpansion from './OwnerExpansion';
import OwnerContinuity from './OwnerContinuity';
import OwnerReports from './OwnerReports';

export default function BusinessOwnerConsole({ businessId, role }) {
  return (
    <div>
      <BusinessLaunchConsole businessId={businessId} />
      <OwnerOversight businessId={businessId} />
      <OwnerPolicies businessId={businessId} role={role} />
      <OwnerFinance businessId={businessId} />
      <OwnerExpansion businessId={businessId} />
      <OwnerReports businessId={businessId} />
      <OwnerContinuity businessId={businessId} role={role} />
    </div>
  );
}
