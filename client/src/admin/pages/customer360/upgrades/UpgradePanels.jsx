import EventLog from "./EventLog";
import Health from "./Health";
import Anomalies from "./Anomalies";
import Links from "./Links";
import Lifecycle from "./Lifecycle";
import Inbox from "./Inbox";

// Mount point for the Customer 360 upgrade areas. Each panel loads its own
// data from an audited endpoint, so nothing is fetched until it is opened.
export const UPGRADE_AREAS = ["events", "health", "anomalies", "links", "lifecycle", "inbox"];

export default function UpgradePanels({ area, ...props }) {
  if (area === "events") return <EventLog {...props} />;
  if (area === "health") return <Health {...props} />;
  if (area === "anomalies") return <Anomalies {...props} />;
  if (area === "links") return <Links {...props} />;
  if (area === "lifecycle") return <Lifecycle {...props} />;
  if (area === "inbox") return <Inbox {...props} />;
  return null;
}
