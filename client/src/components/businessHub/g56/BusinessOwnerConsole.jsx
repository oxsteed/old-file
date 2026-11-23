// Groups 5-6 business owner console (items 201-250). Each section is its own
// server-authorized panel; a section the caller cannot use renders its error.
import BusinessLaunchConsole from './BusinessLaunchConsole';
import OwnerOversight from './OwnerOversight';
import OwnerPolicies from './OwnerPolicies';
import OwnerFinance from './OwnerFinance';

export default function BusinessOwnerConsole({ businessId, role }) {
  return (
    <div>
      <BusinessLaunchConsole businessId={businessId} />
      <OwnerOversight businessId={businessId} />
      <OwnerPolicies businessId={businessId} role={role} />
      <OwnerFinance businessId={businessId} />
    </div>
  );
}
