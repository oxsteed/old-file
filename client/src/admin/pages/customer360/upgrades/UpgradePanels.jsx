import EventLog from "./EventLog";
import Health from "./Health";

// Mount point for the Customer 360 upgrade areas. Each panel loads its own
// data from an audited endpoint, so nothing is fetched until it is opened.
export const UPGRADE_AREAS = ["events", "health"];

export default function UpgradePanels({ area, ...props }) {
  if (area === "events") return <EventLog {...props} />;
  if (area === "health") return <Health {...props} />;
  return null;
}
