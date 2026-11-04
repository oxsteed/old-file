import { useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useSupportLauncherClearance } from '../hooks/useSupportLauncherClearance';

export default function SupportLauncher({ children, yieldToPage = true, ...props }) {
  const ref = useRef(null);
  const location = useLocation();
  useSupportLauncherClearance(ref, location.pathname + location.search, yieldToPage);
  return <button {...props} ref={ref} data-pwa-support-launcher>{children}</button>;
}
