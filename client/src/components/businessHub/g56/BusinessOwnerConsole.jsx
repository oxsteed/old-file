// Groups 5-6 business owner console (items 201-250). Each section is its own
// server-authorized panel; a section the caller cannot use renders its error.
import BusinessLaunchConsole from './BusinessLaunchConsole';

export default function BusinessOwnerConsole({ businessId }) {
  return (
    <div>
      <BusinessLaunchConsole businessId={businessId} />
    </div>
  );
}
