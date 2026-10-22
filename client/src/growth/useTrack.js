import { createContext, useContext } from "react";

// Stable hook boundary for feature components. ActivityTracker owns the
// queue and provider; consumers only receive the fail-closed no-op default.
export const TrackingContext = createContext(() => {});
export const useTrack = () => useContext(TrackingContext);
